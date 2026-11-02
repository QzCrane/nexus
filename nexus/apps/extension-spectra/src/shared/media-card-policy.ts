// goal: one pure projection of known media into dynamic current and inactive sets
// inv: discovery, availability, recent use and control authority are independent

export const MEDIA_FACTS_KEY = 'spectra.media-facts.v1';

export interface MediaCardEvidence {
	documentId: string;
	outcome: 'found' | 'no-media';
	playing?: boolean;
	pausedAt?: number | null;
	userInteracted?: boolean;
	usedAt?: number;
	unavailableAt?: number;
}

export interface StoredMediaFact extends MediaCardEvidence {
	at: number;
	source: 'report' | 'probe';
	schemaVersion?: 2;
	reportRevision?: number;
}

/** The Background and Popup decode exactly the same session projection. */
export function isStoredMediaFact(value: unknown): value is StoredMediaFact {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const fact = value as Record<string, unknown>;
	const ordered = fact.schemaVersion === 2;
	const required = ordered ? ['schemaVersion', 'documentId', 'outcome', 'at', 'source', 'reportRevision'] : ['documentId', 'outcome', 'at', 'source'];
	const optional = ordered ? ['playing', 'pausedAt', 'userInteracted', 'usedAt', 'unavailableAt'] : [];
	return required.every((key) => Object.hasOwn(fact, key))
		&& Object.keys(fact).every((key) => required.includes(key) || optional.includes(key))
		&& typeof fact.documentId === 'string' && fact.documentId.length > 0
		&& (fact.outcome === 'found' || fact.outcome === 'no-media')
		&& Number.isSafeInteger(fact.at) && Number(fact.at) >= 0
		&& (ordered ? fact.source === 'report' && Number.isSafeInteger(fact.reportRevision) && Number(fact.reportRevision) > 0 : fact.source === 'report' || fact.source === 'probe')
		&& (!Object.hasOwn(fact, 'playing') || typeof fact.playing === 'boolean')
		&& (!Object.hasOwn(fact, 'pausedAt') || fact.pausedAt === null || Number.isSafeInteger(fact.pausedAt) && Number(fact.pausedAt) >= 0)
		&& (fact.playing !== true || !Object.hasOwn(fact, 'pausedAt') || fact.pausedAt === null)
		&& (!Object.hasOwn(fact, 'userInteracted') || typeof fact.userInteracted === 'boolean')
		&& (!Object.hasOwn(fact, 'usedAt') || Number.isSafeInteger(fact.usedAt) && Number(fact.usedAt) >= 0)
		&& (!Object.hasOwn(fact, 'unavailableAt') || Number.isSafeInteger(fact.unavailableAt) && Number(fact.unavailableAt) >= 0);
}

export type MediaTabAvailability = 'runnable' | 'frozen' | 'discarded' | 'unloaded';

export function mediaTabAvailability(tab: Pick<chrome.tabs.Tab, 'discarded' | 'frozen' | 'status'>): MediaTabAvailability {
	if (tab.discarded) return 'discarded';
	if (tab.status === 'unloaded') return 'unloaded';
	return tab.frozen ? 'frozen' : 'runnable';
}

export function isMediaTab(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>): tab is typeof tab & { id: number } {
	if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url) return false;
	try { return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol); }
	catch { return false; }
}

export interface MediaCardMembership {
	tabs: number[];
	inactiveTabs: number[];
	nextExpiryAt?: number;
	/** Absolute display deadlines, derived here so a closed Popup cannot retain stale slots. */
	expiryByTab?: Record<string, number>;
}

/** No renderer work, no activity mutation, and no fixed number of visible cards. */
export function projectMediaCardMembership(
	tabs: readonly chrome.tabs.Tab[],
	readFact: (tabId: number) => MediaCardEvidence | null,
	pauseRetentionSeconds: number,
	now = Date.now(),
): MediaCardMembership {
	const current: number[] = [];
	const inactive: number[] = [];
	let nextExpiryAt: number | undefined;
	const expiryByTab: Record<string, number> = {};
	for (const tab of tabs) {
		if (!isMediaTab(tab)) continue;
		const availability = mediaTabAvailability(tab);
		if (availability === 'runnable' && tab.audible) { current.push(tab.id); continue; }
		const fact = readFact(tab.id);
		if (fact?.outcome !== 'found') continue;
		// An old unsequenced forecast contains no use/playback evidence. Preserve
		// its loaded-page presentation until the current producer reports, but an
		// unloaded tab with no usable document is never promoted by that forecast.
		const legacy = fact.playing === undefined && fact.pausedAt === undefined && fact.usedAt === undefined;
		if (legacy) {
			if (availability === 'runnable') current.push(tab.id);
			continue;
		}
		const used = fact.userInteracted === true || (fact.usedAt ?? 0) > 0;
		if (!used) { inactive.push(tab.id); continue; }
		if (availability === 'runnable' && fact.playing === true) { current.push(tab.id); continue; }
		// A real return to a paused tab is a new use, while Popup reads and
		// browser freezing never rewrite the physical pause timestamp.
		const stoppedAt = Math.max(fact.pausedAt ?? fact.unavailableAt ?? 0, fact.usedAt ?? 0) || undefined;
		const recent = pauseRetentionSeconds === 0 || stoppedAt !== undefined
			&& now >= stoppedAt && now - stoppedAt < pauseRetentionSeconds * 1_000;
		if (recent && pauseRetentionSeconds > 0 && stoppedAt !== undefined) {
			const expiry = stoppedAt + pauseRetentionSeconds * 1_000;
			if (expiry > now) nextExpiryAt = Math.min(nextExpiryAt ?? expiry, expiry);
			expiryByTab[String(tab.id)] = expiry;
		}
		(recent ? current : inactive).push(tab.id);
	}
	return { tabs: current.sort((a, b) => a - b), inactiveTabs: inactive.sort((a, b) => a - b),
		...(nextExpiryAt === undefined ? {} : { nextExpiryAt, expiryByTab }) };
}
