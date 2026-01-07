// goal: orchestrates audio state transitions during fullscreen requests
// note: Chrome has known bug - createMediaElementSource conflicts with fullscreen transition
// note: Both CAPTURE and WEBAUDIO modes need pause/resume during fullscreen

import { AudioMode, WebAudioController } from '@nexus/audio-engine';
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

// eff: sets up fullscreen transition handlers for both CAPTURE and WEBAUDIO modes
// post: returns a cleanup function to remove event listeners and clear pending timers
// note: fullscreen transitions require pause for both CAPTURE and WEBAUDIO (Chrome bug)
export function setupFullscreenHandler(
	state: PolicyExecutorState,
	policyExecutor: PolicyExecutor,
	captureManager: CaptureManager,
	audioController: WebAudioController,
	config: Partial<FullscreenHandlerConfig> = {}
): () => void {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	if (!cfg.enabled) return () => { };

	let savedVolume: number | null = null;
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let pausedForFullscreen = false;
	let pauseCount = 0;
	let pausedMode: string | null = null;

	// eff: temporarily suspends audio processing to allow clean fullscreen transition
	async function handlePause(): Promise<void> {
		const isCapture = captureManager.isActive() || state.activeMode === AudioMode.CAPTURE;
		const isWebAudio = state.activeMode === AudioMode.NATIVE_WEBAUDIO;

		// rule: both CAPTURE and WEBAUDIO need pause during fullscreen (Chrome bug)
		if (!isCapture && !isWebAudio) {
			// no-op but still confirm to avoid timeout
			window.postMessage({ type: 'SPECTRA_PAUSE_CONFIRMED' }, '*');
			return;
		}

		pauseCount++;
		const currentPause = pauseCount;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		if (!pausedForFullscreen) {
			savedVolume = state.config.volume;
			pausedForFullscreen = true;
			pausedMode = state.activeMode;
			log.info(`[FS] Fullscreen request, saving volume ${savedVolume}%, pausing ${pausedMode}`);

			if (isCapture) {
				// rule: pause CAPTURE during fullscreen (Chrome tabCapture + fullscreen conflict)
				captureManager.request(false, state.config);
			} else if (isWebAudio) {
				// rule: cleanup WebAudio (reset to unity gain) but keep AudioContext alive
				// note: destroyContext doesn't work because createMediaElementSource binding is permanent
				// strategy: WebAudio paused (cleanup), fullscreen uses native DOM audio, restore after
				audioController.cleanup();
			}
		}

		// eff: notify Injector that pause is complete so fullscreen can proceed safely
		window.postMessage({ type: 'SPECTRA_PAUSE_CONFIRMED' }, '*');

		// rule: auto-restore after 3s timeout to prevent permanent audio loss
		restoreTimer = setTimeout(() => {
			if (pauseCount !== currentPause) return;
			restoreTimer = null;
			if (pausedForFullscreen) {
				log.info('[FS] Fullscreen timeout, reviving enhancement');
				restoreAudio();
			}
		}, 3000);
	}

	// eff: restores audio after fullscreen transition completes
	function handleEntered(): void {
		if (!pausedForFullscreen) return;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		log.info('[FS] Fullscreen entered, restoring delayed');

		restoreTimer = setTimeout(() => {
			restoreTimer = null;
			restoreAudio();
		}, cfg.restoreDelayMs);
	}

	// eff: re-activates audio processing with previously saved settings
	function restoreAudio(): void {
		if (!pausedForFullscreen) return;
		const modeToRestore = pausedMode;
		pausedForFullscreen = false;
		pausedMode = null;

		if (!state.config.enabled) {
			savedVolume = null;
			return;
		}

		const vol = savedVolume ?? state.config.volume;
		log.info(`[FS] Restoring ${modeToRestore}, volume ${vol}%`);
		state.userHasInteracted = true;

		if (modeToRestore === AudioMode.CAPTURE) {
			captureManager.request(true, { ...state.config, volume: vol });
		}
		// note: for WEBAUDIO, ctx was destroyed; applyState will reinitialize and reattach

		savedVolume = null;

		// eff: re-apply state to restore audio processing (will rebuild AudioContext for WEBAUDIO)
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
