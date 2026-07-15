// goal: manages the extension icon badge (text and background color) based on user interaction and audio state
// rule: the badge is "sticky" per tab but only appears if the user has explicitly interacted with audio settings

import { router, badgeState, BADGE_COLORS } from '../state';
import { isTabExists } from '../helpers';
import type { AudioSessionSnapshot } from '@nexus/contracts';

interface BadgeUpdate {
	volume: number;
	muted: boolean;
	enabled?: boolean;
	isCapture: boolean;
	userInteracted?: boolean;
}

export async function updateBadgeForTab(tabId: number, update: BadgeUpdate): Promise<void> {
	if (!await isTabExists(tabId)) {
		badgeState.delete(tabId);
		return;
	}

	const { volume, muted, isCapture, userInteracted } = update;
	if (!userInteracted) {
		badgeState.delete(tabId);
		try {
			await chrome.action.setBadgeText({ tabId, text: '' });
		} catch { }
		return;
	}

	let badgeText = '';
	const enabled = update.enabled ?? true;
	let badgeColor: string = isCapture ? BADGE_COLORS.CAPTURE : BADGE_COLORS.NATIVE;
	if (!enabled) {
		badgeText = volume.toString();
		badgeColor = '#94a3b8';
	} else if (muted || volume === 0) {
		badgeText = 'M';
		badgeColor = BADGE_COLORS.MUTED;
	} else {
		badgeText = volume.toString();
	}

	badgeState.set(tabId, { volume, muted, isCapture, text: badgeText });
	try {
		await chrome.action.setBadgeText({ tabId, text: badgeText });
		await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
		await chrome.action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE });
	} catch {
		badgeState.delete(tabId);
	}
}

export function updateBadgeFromSession(
	snapshot: AudioSessionSnapshot,
	userInteracted: boolean,
): Promise<void> {
	return updateBadgeForTab(snapshot.tabId, {
		volume: snapshot.actualConfig.volume,
		muted: snapshot.actualConfig.muted,
		enabled: snapshot.actualConfig.enabled,
		isCapture: snapshot.actualMode === 'capture',
		userInteracted,
	});
}

// eff: registers listeners for BADGE_UPDATE and BADGE_CLEAR actions
export function registerBadgeHandlers(): void {
	router.on('BADGE_UPDATE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return;
		await updateBadgeForTab(tabId, req);
	});

	router.on('BADGE_CLEAR', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return;

		badgeState.delete(tabId);

		chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });
	});
}
