// goal: persist per-document media presence facts and probe cooldowns durably
// inv: a complete observation (probe settle or authoritative content report) is the
//      only writer; transient outcomes (denied/stale/unknown) never become facts
//
// A fact names one document by `documentId` and is retired by events, not by a
// counter: the lifecycle forgets it synchronously on a top-level navigation, and
// every probe verifies the frame identity it observed around the injection. An
// in-memory document counter would be a second, weaker witness - it restarts with
// the service worker, so a fact that is still perfectly true would be discarded
// after every worker stop, and the inventory would re-probe the whole browser.

import { swLog } from '../shared/logger';

export type MediaFactOutcome = 'found' | 'no-media';
export type MediaFactSource = 'report' | 'probe';
export type MediaProbeCooldownOutcome = 'denied' | 'stale' | 'unknown' | 'pending';

export interface MediaFact {
	documentId: string;
	outcome: MediaFactOutcome;
	at: number;                 // last settle/report timestamp
	source: MediaFactSource;
}

export interface MediaProbeCooldown {
	outcome: MediaProbeCooldownOutcome;
	until: number;              // absolute expiry timestamp
}

export const NO_MEDIA_FACT_TTL_MS = 10 * 60 * 1000; // probe-sourced no-media fallback TTL
// Durable storage area: unlike storage.session (cleared on browser restart and
// extension reload), storage.local survives both, so a popup open never triggers
// a cold re-probe of every tab after a restart. The lifecycle layer invalidates
// facts/cooldowns on navigation and tab removal, so the mirror stays bounded.
const MEDIA_FACTS_KEY = 'spectra.media-facts.v1';
const MEDIA_COOLDOWNS_KEY = 'spectra.media-probe-cooldowns.v1';

function isMediaFact(value: unknown): value is MediaFact {
	if (!value || typeof value !== 'object') return false;
	const fact = value as Record<string, unknown>;
	return typeof fact.documentId === 'string'
		&& fact.documentId.length > 0
		&& (fact.outcome === 'found' || fact.outcome === 'no-media')
		&& Number.isFinite(fact.at) && Number(fact.at) >= 0
		&& (fact.source === 'report' || fact.source === 'probe');
}

function isMediaProbeCooldown(value: unknown): value is MediaProbeCooldown {
	if (!value || typeof value !== 'object') return false;
	const cooldown = value as Record<string, unknown>;
	return (cooldown.outcome === 'denied' || cooldown.outcome === 'stale'
		|| cooldown.outcome === 'unknown' || cooldown.outcome === 'pending')
		&& Number.isFinite(cooldown.until) && Number(cooldown.until) >= 0;
}

export interface MediaFacts {
	/** Memoized hydrate; await before the first read/write from a fresh worker. */
	ready(): Promise<void>;
	readMediaFact(tabId: number): MediaFact | null;
	rememberMediaFact(
		tabId: number,
		documentId: string | null,
		outcome: MediaFactOutcome,
		source: MediaFactSource,
		now?: number,
	): void;
	forgetMediaFact(tabId: number): void;
	readCooldown(tabId: number): MediaProbeCooldown | null;
	rememberCooldown(tabId: number, outcome: MediaProbeCooldownOutcome, until: number): void;
	forgetCooldown(tabId: number): void;
	flushMediaFacts(): Promise<void>;
	isFactCurrent(fact: MediaFact, now?: number): boolean;
}

export function createMediaFacts(): MediaFacts {
	const facts = new Map<number, MediaFact>();
	const cooldowns = new Map<number, MediaProbeCooldown>();
	let dirty = false;
	let revision = 0;
	let hydratePromise: Promise<void> | null = null;
	let flushScheduled = false;

	const hydrate = async (): Promise<void> => {
		try {
			const [stored, storedCooldowns] = await Promise.all([
				chrome.storage.local.get(MEDIA_FACTS_KEY),
				chrome.storage.local.get(MEDIA_COOLDOWNS_KEY),
			]);
			const raw = stored[MEDIA_FACTS_KEY];
			if (raw && typeof raw === 'object') {
				for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
					const tabId = Number(key);
					if (!Number.isSafeInteger(tabId) || tabId <= 0 || !isMediaFact(value)) continue;
					const current = facts.get(tabId);
					// A pre-hydration observation (e.g. a media report that arrived
					// before the first storage read) is fresher than a stored fact.
					if (current && current.at > value.at) continue;
					facts.set(tabId, value);
				}
			}
			const rawCooldowns = storedCooldowns[MEDIA_COOLDOWNS_KEY];
			if (rawCooldowns && typeof rawCooldowns === 'object') {
				const now = Date.now();
				for (const [key, value] of Object.entries(rawCooldowns as Record<string, unknown>)) {
					const tabId = Number(key);
					if (!Number.isSafeInteger(tabId) || tabId <= 0 || !isMediaProbeCooldown(value)) continue;
					// Expired cooldowns are garbage: the next scan re-evaluates the tab.
					if (value.until < now) continue;
					cooldowns.set(tabId, value);
				}
			}
		} catch (error) {
			// A failed hydrate must not wedge the worker: fall back to an empty
			// mirror and let the next probes/registers rebuild the facts.
			swLog.warn('[MediaFacts] hydrate failed', error);
		}
	};

	const persist = async (): Promise<void> => {
		// Hydrate first so an eager flush never clobbers persisted facts.
		hydratePromise ??= hydrate();
		await hydratePromise;
		if (!dirty) return;
		const observedRevision = revision;
		await chrome.storage.local.set({
			[MEDIA_FACTS_KEY]: Object.fromEntries(facts),
			[MEDIA_COOLDOWNS_KEY]: Object.fromEntries(cooldowns),
		});
		// Only clear the dirty flag when no mutation raced the write; otherwise
		// the caller loops once more and persists the newer snapshot.
		if (revision === observedRevision) dirty = false;
	};

	// Persistence must not depend on chrome.runtime.onSuspend, a best-effort
	// hook Chrome may skip on abrupt worker termination. Every fact mutation
	// schedules a coalesced flush, so the next worker hydrates the last settled
	// observation instead of re-probing every tab on popup open.
	const scheduleFlush = (): void => {
		if (flushScheduled) return;
		flushScheduled = true;
		void (async () => {
			try {
				for (;;) {
					await persist();
					if (!dirty) return;
				}
			} catch (error) {
				// A failed flush must not wedge the worker; dirty stays set and
				// the next mutation retries.
				swLog.warn('[MediaFacts] flush failed', error);
			} finally {
				flushScheduled = false;
			}
		})();
	};

	return {
		ready() {
			hydratePromise ??= hydrate();
			return hydratePromise;
		},

		readMediaFact(tabId) {
			return facts.get(tabId) ?? null;
		},

		rememberMediaFact(tabId, documentId, outcome, source, now = Date.now()) {
			if (!documentId) return;
			facts.set(tabId, { documentId, outcome, at: now, source });
			dirty = true;
			revision++;
			scheduleFlush();
		},

		forgetMediaFact(tabId) {
			if (!facts.delete(tabId)) return;
			dirty = true;
			revision++;
			scheduleFlush();
		},

		readCooldown(tabId) {
			return cooldowns.get(tabId) ?? null;
		},

		rememberCooldown(tabId, outcome, until) {
			const current = cooldowns.get(tabId);
			// Keep the stronger existing cooldown: a longer denial must not be
			// downgraded by a later short-lived transient failure.
			if (current && current.until >= until) return;
			cooldowns.set(tabId, { outcome, until });
			dirty = true;
			revision++;
			scheduleFlush();
		},

		forgetCooldown(tabId) {
			if (!cooldowns.delete(tabId)) return;
			dirty = true;
			revision++;
			scheduleFlush();
		},

		async flushMediaFacts() {
			await persist();
		},

		isFactCurrent(fact, now = Date.now()) {
			if (fact.outcome === 'found') return true;
			// A content-script report is event-driven: the reporter re-sends on
			// media-registry changes, visibility changes, and pageshow/bfcache
			// restore, so a reported no-media fact stays current until the document
			// itself changes. Only probe-sourced no-media needs a fallback TTL.
			if (fact.source === 'report') return true;
			return now - fact.at < NO_MEDIA_FACT_TTL_MS;
		},
	};
}

export const mediaFacts = createMediaFacts();
