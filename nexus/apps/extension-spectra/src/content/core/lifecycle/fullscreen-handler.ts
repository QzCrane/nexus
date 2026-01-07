// goal: orchestrates capture state transitions during fullscreen requests to bypass browser-imposed restriction on capturing elements while entering fullscreen
// note: Chrome prohibits requestFullscreen() if tab is being "captured" via tabCapture API; we briefly detach to allow the transition
// note: WebAudio mode does NOT need pause/resume - it works fine during fullscreen transitions

import { AudioMode } from '@nexus/audio-engine';
import { logger } from '../../../shared/logger';
import type { PolicyExecutorState } from '../../types';
import type { CaptureManager } from '../../audio/capture-manager';
import type { PolicyExecutor } from '../../logic/policy-executor/types';

const log = logger.content;

interface FullscreenHandlerConfig {
	restoreDelayMs: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: FullscreenHandlerConfig = {
	restoreDelayMs: 500,
	enabled: true,
};

// eff: sets up inter-process message listeners to coordinate capture suspension and restoration
// post: returns a cleanup function to remove event listeners and clear pending timers
export function setupFullscreenHandler(
	state: PolicyExecutorState,
	policyExecutor: PolicyExecutor,
	captureManager: CaptureManager,
	config: Partial<FullscreenHandlerConfig> = {}
): () => void {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	if (!cfg.enabled) return () => { };

	let savedVolume: number | null = null;
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let pausedForFullscreen = false;
	let pauseCount = 0;  // inv: strictly increments to avoid race conditions with multiple rapid FS requests

	// eff: temporarily kills tab capture to satisfy browser "user interaction" requirements for FS
	// note: WebAudio mode does NOT need pause - it doesn't conflict with fullscreen transitions
	function handlePause(): void {
		const isCapture = captureManager.isActive() || state.activeMode === AudioMode.CAPTURE;

		// rule: only CAPTURE mode needs pause/resume; WebAudio works fine during fullscreen
		if (!isCapture) return;

		pauseCount++;
		const currentPause = pauseCount;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		if (!pausedForFullscreen) {
			savedVolume = state.config.volume;
			pausedForFullscreen = true;
			log.info(`[FS] Fullscreen request, saving volume ${savedVolume}%, pausing CAPTURE`);

			captureManager.request(false, state.config);
		}

		// rule: if the transition isn't completed within 3s, automatically restore capture to ensure audio isn't permanently lost
		restoreTimer = setTimeout(() => {
			if (pauseCount !== currentPause) return;
			restoreTimer = null;
			if (pausedForFullscreen) {
				log.info('[FS] Fullscreen timeout, reviving enhancement');
				restoreCapture();
			}
		}, 3000);
	}

	// eff: restores capture after a short delay to ensure the native fullscreen transition has visually stabilized
	function handleEntered(): void {
		if (!pausedForFullscreen) return;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		log.info('[FS] Fullscreen entered, restoring delayed');

		restoreTimer = setTimeout(() => {
			restoreTimer = null;
			restoreCapture();
		}, cfg.restoreDelayMs);
	}

	// eff: re-activates the tab capture session with the previously saved volume setting
	function restoreCapture(): void {
		if (!pausedForFullscreen) return;
		pausedForFullscreen = false;

		if (!state.config.enabled) {
			savedVolume = null;
			return;
		}

		const vol = savedVolume ?? state.config.volume;
		log.info(`[FS] Restoring enhancement, volume ${vol}%`);
		state.userHasInteracted = true;

		// Note: for CAPTURE, we must explicitly request it. For WebAudio, applyState() handles it via executeMode.
		// However, captureManager.request() is async.
		if (state.activeMode === AudioMode.CAPTURE || captureManager.isActive()) {
			captureManager.request(true, { ...state.config, volume: vol });
		}

		savedVolume = null;

		// eff: re-apply volume config to DOM elements to override injector's temporary 100% setting
		setTimeout(() => policyExecutor.applyState(), 100);
	}

	function handleMessage(event: MessageEvent): void {
		if (event.source !== window) return;
		switch (event.data?.type) {
			case 'SPECTRA_PAUSE_FOR_FULLSCREEN': handlePause(); break;
			case 'SPECTRA_FULLSCREEN_ENTERED': handleEntered(); break;
		}
	}

	window.addEventListener('message', handleMessage);
	log.debug('[FS] Fullscreen Handler enabled');

	return () => {
		window.removeEventListener('message', handleMessage);
		if (restoreTimer) clearTimeout(restoreTimer);
	};
}
