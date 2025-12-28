/**
 * // goal: Manage capture state during fullscreen transitions
 * // rule: Disable capture on FS request, restore after entered or timeout
 */

import { AudioMode } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { CaptureManager } from '../capture-manager';

const log = logger.content;

interface FullscreenHandlerConfig {
	restoreDelayMs: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: FullscreenHandlerConfig = {
	restoreDelayMs: 500,
	enabled: true,
};

export function setupFullscreenHandler(
	state: PolicyExecutorState,
	_policyExecutor: unknown,
	captureManager: CaptureManager,
	config: Partial<FullscreenHandlerConfig> = {}
): () => void {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	if (!cfg.enabled) return () => { };

	let savedVolume: number | null = null;
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let pausedForFullscreen = false;
	let pauseCount = 0;  // inv: Prevent duplicate restores

	// goal: Temporarily disable capture to allow native FS
	function handlePause(): void {
		const isCapture = captureManager.isActive() || state.activeMode === AudioMode.CAPTURE;
		if (!isCapture) return;

		pauseCount++;
		const currentPause = pauseCount;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		if (!pausedForFullscreen) {
			savedVolume = state.config.volume;
			pausedForFullscreen = true;
			log.info(`[FS] Fullscreen request, saving volume ${savedVolume}%, disabling hijack`);
			captureManager.request(false, state.config);
		}

		// rule: Safety net (timeout 3s)
		restoreTimer = setTimeout(() => {
			if (pauseCount !== currentPause) return;  // Overridden by new request
			restoreTimer = null;
			if (pausedForFullscreen) {
				log.info('[FS] Fullscreen timeout, reviving hijack');
				restoreCapture();
			}
		}, 3000);
	}

	// goal: Re-enable capture after transition
	function handleEntered(): void {
		if (!pausedForFullscreen) return;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		log.info('[FS] Fullscreen entered, restoring delayed');

		restoreTimer = setTimeout(() => {
			restoreTimer = null;
			restoreCapture();
		}, cfg.restoreDelayMs);
	}

	// goal: Restore state
	function restoreCapture(): void {
		if (!pausedForFullscreen) return;
		pausedForFullscreen = false;

		if (!state.config.enabled) {
			savedVolume = null;
			return;
		}

		const vol = savedVolume ?? state.config.volume;
		log.info(`[FS] Restoring hijack, volume ${vol}%`);
		state.userHasInteracted = true;
		captureManager.request(true, { ...state.config, volume: vol });
		savedVolume = null;
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
