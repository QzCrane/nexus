// goal: persist per-document media presence verdicts durably
// inv: the document's own content script is the only writer; a fact names the
//      document it describes and is retired by navigation, never by a counter
//
// A fact is the inventory's memory of what a tab is playing. It exists because a
// service worker is not: without it, every worker stop would blank the Popup's
// background list until each page happened to report again.
//
// A fact names one document by `documentId` and is retired by events, not by a
// TTL. The lifecycle forgets it synchronously on a top-level navigation and on tab
// removal, and a newer report from the same document replaces it; those are the
// only ways a verdict can stop being true. An in-memory document counter would be
// a second, weaker witness - it restarts with the service worker, so a fact that
// is still perfectly true would be discarded after every worker stop.

import { swLog } from '../shared/logger';

export type MediaFactOutcome = 'found' | 'no-media';
/** `probe` only appears in data written before the inventory stopped probing. */
export type MediaFactSource = 'report' | 'probe';

export interface MediaFact {
	documentId: string;
	outcome: MediaFactOutcome;
	at: number;                 // last report timestamp
	source: MediaFactSource;
}

// Durable storage area: unlike storage.session (cleared on browser restart and
// extension reload), storage.local survives both, so a popup open never blanks the
// list after a restart. The lifecycle layer invalidates facts on navigation and tab
// removal, so the mirror stays bounded.
const MEDIA_FACTS_KEY = 'spectra.media-facts.v1';

function isMediaFact(value: unknown): value is MediaFact {
	if (!value || typeof value !== 'object') return false;
	const fact = value as Record<string, unknown>;
	return typeof fact.documentId === 'string'
		&& fact.documentId.length > 0
		&& (fact.outcome === 'found' || fact.outcome === 'no-media')
		&& Number.isFinite(fact.at) && Number(fact.at) >= 0
		&& (fact.source === 'report' || fact.source === 'probe');
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
	/** Number of remembered documents (diagnostics only). */
	size(): number;
	flushMediaFacts(): Promise<void>;
}

export function createMediaFacts(): MediaFacts {
	const facts = new Map<number, MediaFact>();
	let dirty = false;
	let revision = 0;
	let hydratePromise: Promise<void> | null = null;
	let flushScheduled = false;

	const hydrate = async (): Promise<void> => {
		try {
			const stored = await chrome.storage.local.get(MEDIA_FACTS_KEY);
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
		} catch (error) {
			// A failed hydrate must not wedge the worker: fall back to an empty
			// mirror and let the next reports rebuild the facts.
			swLog.warn('[MediaFacts] hydrate failed', error);
		}
	};

	const persist = async (): Promise<void> => {
		// Hydrate first so an eager flush never clobbers persisted facts.
		hydratePromise ??= hydrate();
		await hydratePromise;
		if (!dirty) return;
		const observedRevision = revision;
		await chrome.storage.local.set({ [MEDIA_FACTS_KEY]: Object.fromEntries(facts) });
		// Only clear the dirty flag when no mutation raced the write; otherwise
		// the caller loops once more and persists the newer snapshot.
		if (revision === observedRevision) dirty = false;
	};

	// Persistence must not depend on chrome.runtime.onSuspend, a best-effort
	// hook Chrome may skip on abrupt worker termination. Every fact mutation
	// schedules a coalesced flush, so the next worker hydrates the last reported
	// verdict instead of showing an empty list.
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

		size() {
			return facts.size;
		},

		async flushMediaFacts() {
			await persist();
		},
	};
}

export const mediaFacts = createMediaFacts();
