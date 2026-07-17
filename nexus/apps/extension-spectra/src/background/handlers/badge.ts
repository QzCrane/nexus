// goal: manages the extension icon badge (text and background color) based on user interaction and audio state
// rule: the badge is "sticky" per tab but only appears if the user has explicitly interacted with audio settings

import { router, badgeState, BADGE_COLORS } from '../state';
import { isTabExists } from '../helpers';
import {
	audioSessionMatchesControlDocument,
	isActiveCaptureLifecycle,
	resolveAudioVolume,
	resolveAudioVolumeState,
	type AudioConfig,
	type AudioSessionSnapshot,
	type ControlSnapshot,
} from '@nexus/contracts';

interface BadgeUpdate {
	volume: number;
	muted: boolean;
	enabled?: boolean;
	isCapture: boolean;
	userInteracted?: boolean;
}

type BadgeAuthority = 'control' | 'session' | 'legacy';
type BadgeIdentity = Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'>;

async function applyBadgeForTab(
	tabId: number,
	update: BadgeUpdate,
	authority: BadgeAuthority,
	identity: BadgeIdentity | null = null,
): Promise<void> {
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
	const volumeState = resolveAudioVolumeState({
		volume,
		muted,
		actualMode: isCapture ? 'capture' : 'bypass',
		phase: isCapture ? 'active' : 'idle',
	});
	let badgeColor: string = volumeState === 'capture'
		? BADGE_COLORS.CAPTURE
		: volumeState === 'silent'
			? BADGE_COLORS.MUTED
			: BADGE_COLORS.NATIVE;
	if (!enabled) {
		badgeText = volume.toString();
		badgeColor = '#94a3b8';
	} else if (volumeState === 'silent') {
		badgeText = 'M';
		badgeColor = BADGE_COLORS.MUTED;
	} else {
		badgeText = volume.toString();
	}

	badgeState.set(tabId, {
		volume,
		muted,
		enabled,
		isCapture,
		userInteracted: true,
		authority,
		text: badgeText,
		documentId: identity?.documentId ?? null,
		origin: identity?.origin ?? null,
		generation: identity?.generation ?? null,
	});
	try {
		await chrome.action.setBadgeText({ tabId, text: badgeText });
		await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
		await chrome.action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE });
	} catch {
		badgeState.delete(tabId);
	}
}

export function updateBadgeForTab(tabId: number, update: BadgeUpdate): Promise<void> {
	return applyBadgeForTab(tabId, update, 'legacy');
}

export function updateBadgeFromControlProjection(
	snapshot: Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin' | 'generation'>,
	config: AudioConfig,
	isCaptureActive: boolean,
	userInteracted: boolean,
): Promise<void> {
	const volume = resolveAudioVolume(config);
	const stickyInteraction = userInteracted || badgeState.get(snapshot.tabId)?.userInteracted === true;
	return applyBadgeForTab(snapshot.tabId, {
		volume: volume.effectiveVolume,
		muted: config.muted,
		enabled: config.enabled,
		isCapture: isCaptureActive,
		userInteracted: stickyInteraction,
	}, 'control', snapshot);
}

export function updateBadgeFromSession(
	snapshot: AudioSessionSnapshot,
	userInteracted: boolean,
): Promise<void> {
	const previous = badgeState.get(snapshot.tabId);
	const keepControlActual = previous?.authority === 'control'
		&& audioSessionMatchesControlDocument(snapshot, {
			tabId: snapshot.tabId,
			documentId: previous.documentId ?? '',
			origin: previous.origin ?? '',
		});
	// AudioSessionSnapshot owns lifecycle only. Without a matching actual control
	// projection, hiding the badge is safer than publishing stale volume/color.
	if (!keepControlActual) {
		badgeState.delete(snapshot.tabId);
		// Badge rendering is a best-effort projection of acknowledged audio state.
		// A missing/unavailable Action API must never turn a successful processor
		// transition into a failed Capture operation.
		return chrome.action?.setBadgeText?.({ tabId: snapshot.tabId, text: '' })
			.catch(() => undefined) ?? Promise.resolve();
	}
	return applyBadgeForTab(snapshot.tabId, {
		volume: previous.volume,
		muted: previous.muted,
		enabled: previous.enabled,
		isCapture: isActiveCaptureLifecycle(snapshot),
		userInteracted: userInteracted || previous?.userInteracted === true,
	}, 'control', snapshot);
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
