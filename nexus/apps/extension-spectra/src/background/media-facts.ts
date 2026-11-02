// goal: persist per-document media presence verdicts durably
// inv: the document's own content script is the only writer; a fact names the
//      document it describes and is retired by navigation, never by a counter
//
// A fact is the inventory's memory of what a tab is playing. It exists because a
// service worker is not: without it, every worker stop would blank the Popup's
// background list until each page happened to report again.
//
// Within one browser/extension session a fact names one document by documentId
// and is retired by events, not a TTL. The lifecycle forgets it on navigation and
// removal, and a newer report from the same document replaces it; those are the
// only ways a same-session verdict can stop being true. An in-memory counter would be
// a second, weaker witness - it restarts with the service worker, so a fact that
// is still perfectly true would be discarded after every worker stop.

import { swLog } from '../shared/logger';
import { MEDIA_FACTS_KEY, isStoredMediaFact as isMediaFact } from '../shared/media-card-policy';

export type MediaFactOutcome = 'found' | 'no-media';
/** `probe` only appears in data written before the inventory stopped probing. */
export type MediaFactSource = 'report' | 'probe';

export interface MediaFactDetails {
	playing?: boolean;
	pausedAt?: number | null;
	userInteracted?: boolean;
	usedAt?: number;
	unavailableAt?: number;
}

export interface MediaFact extends MediaFactDetails {
	documentId: string;
	outcome: MediaFactOutcome;
	at: number;                 // last report timestamp
	source: MediaFactSource;
	/** Absent only for a legacy, unordered forecast. */
	schemaVersion?: 2;
	reportRevision?: number;
}

// Facts survive worker restart through storage.session, but retire with the
// browser/extension session. An old local mirror is never current evidence.

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
		reportRevision?: number,
		details?: MediaFactDetails,
	): boolean;
	/** Browser activation of already known ordered media; does not advance report ordering. */
	touchMediaFact(tabId: number, now?: number): boolean;
	/** Browser availability is independent of playback, usage and report order. */
	markMediaUnavailable(tabId: number, unavailable: boolean, now?: number): boolean;
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
	let flushPromise: Promise<void> | null = null;
	let hydrated = false;
	// A deletion is a real pre-hydration mutation even when the memory map has
	// not seen the stored row yet. Keep its tombstone only until hydration ends.
	const retiredBeforeHydration = new Set<number>();

	const hydrate = async (): Promise<void> => {
		try {
			const stored = await chrome.storage.session.get(MEDIA_FACTS_KEY);
			const raw = stored[MEDIA_FACTS_KEY];
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
				for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
					const tabId = Number(key);
					if (!Number.isSafeInteger(tabId) || tabId <= 0 || String(tabId) !== key
						|| retiredBeforeHydration.has(tabId) || !isMediaFact(value)) continue;
					const current = facts.get(tabId);
					if (current) {
						// Different-document reports have already passed the browser
						// sender fence. Within one document, report order outranks time;
						// neither wall-clock skew nor a legacy forecast can erase it.
						if (current.reportRevision === undefined) {
							if (value.reportRevision === undefined) continue;
						} else if (current.documentId !== value.documentId
							|| value.reportRevision === undefined || current.reportRevision >= value.reportRevision) continue;
					}
					facts.set(tabId, {
						...value,
						...(current?.documentId === value.documentId && current.userInteracted === true ? { userInteracted: true } : {}),
						...(current?.documentId === value.documentId && current.usedAt !== undefined
							? { usedAt: Math.max(current.usedAt, value.usedAt ?? 0) } : {}),
					});
				}
			}
			hydrated = true;
			retiredBeforeHydration.clear();
		} catch (error) {
			// An unreadable high-water mark is not zero. Reject this attempt and
			// allow a later read to retry without discarding retirement tombstones.
			swLog.warn('[MediaFacts] hydrate failed', error);
			throw error;
		}
	};
	const ensureHydrated = (): Promise<void> => {
		hydratePromise ??= hydrate().catch((error) => {
			hydratePromise = null;
			throw error;
		});
		return hydratePromise;
	};

	const persist = (): Promise<void> => {
		if (flushPromise) return flushPromise;
		// Explicit flush and automatic flush share one writer. Otherwise an old
		// delayed storage.set could land after a newer high-water mark or delete.
		flushPromise = (async () => {
			await ensureHydrated();
			while (dirty) {
				const observedRevision = revision;
				await chrome.storage.session.set({ [MEDIA_FACTS_KEY]: Object.fromEntries(facts) });
				if (revision === observedRevision) dirty = false;
			}
		})().finally(() => { flushPromise = null; });
		return flushPromise;
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
			return ensureHydrated();
		},

		readMediaFact(tabId) {
			return facts.get(tabId) ?? null;
		},

		rememberMediaFact(tabId, documentId, outcome, source, now = Date.now(), reportRevision, details = {}) {
			const current = facts.get(tabId);
			const sameDocument = current !== undefined && current.documentId === documentId;
			const mergedDetails: MediaFactDetails = {
				...details,
				...(sameDocument && current.userInteracted === true ? { userInteracted: true } : {}),
				...(sameDocument && current.usedAt !== undefined
					? { usedAt: Math.max(current.usedAt, details.usedAt ?? 0) } : {}),
				...(sameDocument && current.unavailableAt !== undefined ? { unavailableAt: current.unavailableAt } : {}),
				...(details.playing === true ? { pausedAt: null } : {}),
			};
			const next: MediaFact = reportRevision === undefined
				? { documentId: documentId ?? '', outcome, at: now, source }
				: { schemaVersion: 2, documentId: documentId ?? '', outcome, at: now, source, reportRevision, ...mergedDetails };
			if (!Number.isSafeInteger(tabId) || tabId <= 0 || !isMediaFact(next)) return false;
			if (current?.reportRevision !== undefined
				&& (reportRevision === undefined || current.documentId === documentId && reportRevision <= current.reportRevision)) return false;
			retiredBeforeHydration.delete(tabId);
			facts.set(tabId, next);
			dirty = true;
			revision++;
			scheduleFlush();
			return true;
		},

		touchMediaFact(tabId, now = Date.now()) {
			const fact = facts.get(tabId);
			if (fact?.reportRevision === undefined || fact.outcome !== 'found'
				|| !Number.isSafeInteger(now) || now < 0 || now <= (fact.usedAt ?? -1)) return false;
			facts.set(tabId, { ...fact, usedAt: now });
			dirty = true;
			revision++;
			scheduleFlush();
			return true;
		},

		markMediaUnavailable(tabId, unavailable, now = Date.now()) {
			const fact = facts.get(tabId);
			if (fact?.reportRevision === undefined || fact.outcome !== 'found'
				|| typeof unavailable !== 'boolean' || !Number.isSafeInteger(now) || now < 0) return false;
			if (unavailable === (fact.unavailableAt !== undefined)) return false;
			const next = { ...fact };
			if (unavailable) next.unavailableAt = now;
			else delete next.unavailableAt;
			facts.set(tabId, next);
			dirty = true;
			revision++;
			scheduleFlush();
			return true;
		},

		forgetMediaFact(tabId) {
			if (!Number.isSafeInteger(tabId) || tabId <= 0) return;
			const removed = facts.delete(tabId);
			if (!hydrated) retiredBeforeHydration.add(tabId);
			if (!removed && hydrated) return;
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
