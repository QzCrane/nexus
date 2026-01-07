// goal: routes audio processing commands to the appropriate execution layer (DOM, WebAudio, or Tab Capture) based on the active policy mode

import { AudioMode } from '@nexus/audio-engine';
import type { AudioConfig } from '@nexus/kernel';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import { setDomVolume, isAnyMediaPlaying, releaseVolumeLock, enableVolumeLock, setNativeVolumeCallback } from '../audio/dom-volume';
import { logger } from '../../shared/logger';

const log = logger.content;

let currentState: PolicyExecutorState | null = null;
let currentDeps: PolicyExecutorDeps | null = null;
let currentUpdateBadge: (() => void) | null = null;
let currentBroadcastUI: (() => void) | null = null;

// eff: binds shared state and cross-module callbacks to the mode executor
export function initModeExecutorCallbacks(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	updateBadge: () => void,
	broadcastUI: () => void
): void {
	currentState = state;
	currentDeps = deps;
	currentUpdateBadge = updateBadge;
	currentBroadcastUI = broadcastUI;

	// eff: registers a callback to handle native volume changes initiated by the website UI
	setNativeVolumeCallback((volume, muted) => {
		if (!currentState || !currentDeps) return;

		// note: volume < 0 signals a mute-only toggle without altering the numeric volume percentage
		if (volume < 0) {
			currentState.config.muted = muted;
			log.debug(`[SPECTRA] Native mute toggle: ${muted}`);
		} else {
			// rule: sync both volume and muted state for complete native UI compatibility
			const configVolume = Math.round(volume * 100);
			currentState.config.volume = configVolume;
			currentState.config.muted = muted;
			log.debug(`[SPECTRA] Native volume sync: ${configVolume}% (muted: ${muted})`);
		}

		currentUpdateBadge?.();
		currentBroadcastUI?.();

		// eff: persists the synchronized native state to storage to ensure UI consistency upon reopening
		currentDeps.messenger.send('AUDIO_SET_CONFIG', {
			config: currentState.config,
		}).catch(() => { });
	});
}

// post: returns true if the user has engaged with the page, making it safe to initialize AudioContext
export function hasUserGesture(state: PolicyExecutorState): boolean {
	if (state.userHasInteracted) return true;

	// rule: active media playback or navigator.userActivation signals implied user intent
	if (isAnyMediaPlaying()) return true;

	const userActivation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
	if (userActivation?.hasBeenActive) return true;

	return false;
}

// eff: orchestrates audio modifications by dispatching to specialized controllers based on activeMode
export function executeMode(deps: PolicyExecutorDeps, state: PolicyExecutorState): void {
	const { audioController, captureManager } = deps;
	const mode = state.activeMode;
	const config = state.config;

	if (mode === AudioMode.CAPTURE) {
		if (captureManager.isActive()) {
			// note: capture mode targets the offscreen document; domestic volume locks are released
			releaseVolumeLock();
			captureManager.syncConfig(config);
			notifyInjector(true);
		} else if (hasUserGesture(state)) {
			// log: requesting capture upgrade due to user interaction in capture-eligible mode
			log.capture('Strategy suggests CAPTURE and gesture detected, requesting...');
			captureManager.request(true, config);
			fallbackToDom(config);
		} else {
			fallbackToDom(config);
		}

	} else if (mode === AudioMode.NATIVE_LITE) {
		// mode: strictly uses DOM volume overrides and setter-redirection via 'enableVolumeLock'
		const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
		enableVolumeLock(domVol, config.muted);
		notifyInjector(false);

	} else if (mode === AudioMode.NATIVE_WEBAUDIO) {

		if (hasUserGesture(state)) {
			if (!audioController.isReady()) {
				// note: direct user gesture is required to successfully resume an AudioContext
				audioController.initialize(true).then((success) => {
					if (success) {
						applyWebAudioState(config, deps);
					} else {
						log.debug('WebAudio init failed -> fallback to DOM');
						fallbackToDom(config);
					}
				});
			} else {
				applyWebAudioState(config, deps);
			}
		} else {
			fallbackToDom(config);
		}
	}
}

// eff: applies WebAudio processing while maintaining visual sync with native volume slider
// theory: for <= 100%, we let DOM handle attenuation (visual sync). For > 100%, we lock DOM to 100% and apply boost via WebAudio.
function applyWebAudioState(config: AudioConfig, deps: PolicyExecutorDeps): void {
	const { audioController } = deps;
	const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);

	// rule: calculate effective gain for WebAudio to compensate for DOM attenuation
	// ex: Vol 50% -> Dom 0.5 -> Effective 100% (Unity Gain). Output = 0.5 * 1.0 = 0.5
	// ex: Vol 200% -> Dom 1.0 -> Effective 200% (2.0 Gain). Output = 1.0 * 2.0 = 2.0
	const effectiveConfig = { ...config };
	if (!config.muted && domVol > 0.001) {
		effectiveConfig.volume = (config.volume / 100) / domVol * 100;
	} else {
		// if muted or near zero, gain doesn't matter as source is silent, but keep it safe
		effectiveConfig.volume = config.volume;
	}

	setDomVolume(domVol, config.muted);
	audioController.scanAndAttach();
	audioController.updateParams(effectiveConfig);

	notifyInjector(true);

	// eff: notify injector for WebAudio API hijacking (for sites creating their own contexts)
	// note: we broadcast the REAL requested volume, not the effective one, so hijacked contexts know the target
	window.postMessage({ type: 'SPECTRA_VOLUME_UPDATE', volume: config.volume / 100 }, '*');
}

function notifyInjector(active: boolean): void {
	window.postMessage({ type: 'SPECTRA_ENHANCED_STATE', active }, '*');
}


// eff: basic DOM-based volume control used as a baseline or fallback
// rule: numeric gain is capped at 100% as native HTMLMediaElement doesn't support boost
function fallbackToDom(config: AudioConfig): void {
	const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
	enableVolumeLock(domVol, config.muted);
}
