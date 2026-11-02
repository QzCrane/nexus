// goal: read the canonical session projection without waking the worker or pages
import { MEDIA_FACTS_KEY, isStoredMediaFact, projectMediaCardMembership, type MediaCardMembership } from '../shared/media-card-policy';
import { DEFAULT_GLOBAL_SETTINGS } from '@nexus/contracts';

export async function readMediaMembershipFromStorage(
	allTabs: readonly chrome.tabs.Tab[],
	pauseRetentionSeconds = DEFAULT_GLOBAL_SETTINGS.pauseRetentionSeconds,
): Promise<MediaCardMembership | null> {
	try {
		const stored = await chrome.storage.session.get(MEDIA_FACTS_KEY);
		const records: unknown = stored[MEDIA_FACTS_KEY];
		return projectMediaCardMembership(allTabs, (tabId) => {
			if (!records || typeof records !== 'object' || Array.isArray(records)) return null;
			const value: unknown = (records as Record<string, unknown>)[String(tabId)];
			return isStoredMediaFact(value) ? value : null;
		}, pauseRetentionSeconds);
	} catch { return null; }
}

export async function readVisibleMediaTabIdsFromStorage(allTabs: readonly chrome.tabs.Tab[]): Promise<number[] | null> {
	return (await readMediaMembershipFromStorage(allTabs))?.tabs ?? null;
}
