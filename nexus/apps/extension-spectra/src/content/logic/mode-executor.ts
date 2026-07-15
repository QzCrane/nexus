// goal: routes audio processing commands to the appropriate execution layer (DOM, WebAudio, or Tab Capture) based on the active policy mode

import { AudioMode } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG, type AudioConfig } from '@nexus/kernel';
import { isDefaultAudioConfig } from '@nexus/contracts';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import { setDomVolume, releaseVolumeLock, enableVolumeLock, setNativeVolumeCallback, setNativeSpeedCallback } from '../audio/dom-volume';
import { isAnyMediaPlaying } from '../audio/media-detection';
import { clearTargetSpeed, setSpeed } from './media-control';
import { getSiteBridge } from './site-bridge/registry';
import { logger } from '../../shared/logger';

const log = logger.content;

let currentState: PolicyExecutorState | null = null;
let currentDeps: PolicyExecutorDeps | null = null;
let currentUpdateBadge: (() => void) | null = null;
let currentBroadcastUI: (() => void) | null = null;
let currentUpdateConfig: ((changes: Partial<AudioConfig>, options?: { isNativeSync?: boolean }) => void) | null = null;
let lastWebAudioActive = false;
let executionRun = 0;

// post: an untouched page may report its own volume/speed, but that state must
// not turn the default bypass into a SPECTRA-owned session.
export function shouldAcceptNativeConfigSync(config: AudioConfig, userHasInteracted: boolean): boolean {
	return userHasInteracted || !isDefaultAudioConfig(config);
}

// eff: broadcasts WEBAUDIO mode state to injector for fullscreen handling
function notifyWebAudioState(active: boolean): void {
	if (lastWebAudioActive !== active) {
		lastWebAudioActive = active;
		window.postMessage({ type: 'SPECTRA_WEBAUDIO_STATE', active }, '*');
	}
}

// eff: binds shared state and cross-module callbacks to the mode executor
// eff: register global handler for native changes
function handleNativeVolume(volume: number, muted: boolean) {
	if (!currentState || !currentDeps || !currentUpdateConfig) return;
	if (!shouldAcceptNativeConfigSync(currentState.config, currentState.userHasInteracted)) return;

	const bridge = getSiteBridge();
	if (bridge.shouldInhibitDomSync()) return;

	const newVol = (volume * 100) | 0;

	const ch: Partial<AudioConfig> = {};
	if (volume < 0) {
		ch.muted = muted;
		log.debug(`[Native] Mute: ${muted}`);
	} else {
		ch.volume = newVol;
		ch.muted = muted;
		log.debug(`[Native] Vol: ${ch.volume}%`);
	}
	currentUpdateConfig(ch, { isNativeSync: true });
}

function handleNativeSpeed(speed: number) {
	if (!currentUpdateConfig || !currentState) return;
	if (!shouldAcceptNativeConfigSync(currentState.config, currentState.userHasInteracted)) return;
	const bridge = getSiteBridge();
	if (bridge.shouldInhibitDomSync()) return;

	// rule: new media elements default to playbackRate=1.0, triggering ratechange
	// this must NOT override the user's intended speed setting
	const userSpeed = currentState.config.speed || 1;
	if (Math.abs(speed - 1) < 0.005 && Math.abs(userSpeed - 1) > 0.005) {
		log.debug(`[Native] Speed guard: ignoring 1x default, re-applying ${userSpeed}x`);
		setSpeed(userSpeed);
		return;
	}

	log.debug(`[Native] Speed: ${speed}x`);
	currentUpdateConfig({ speed }, { isNativeSync: true });
}

function handleSiteSyncBack(changes: Partial<AudioConfig>, options?: { isNativeSync?: boolean }) {
	if (!currentState || !currentUpdateConfig) return;
	if (!shouldAcceptNativeConfigSync(currentState.config, currentState.userHasInteracted)) return;

	// rule: [Boost Guard] Prevent native ceiling reports (100%) from overwriting plugin boost (>100%)
	if (changes.volume === 100 && currentState.config.volume > 100) {
		log.debug(`[SiteBridge] Guard: Ignoring 100% report while boosting at ${currentState.config.volume}%`);
		delete changes.volume;
		if (Object.keys(changes).length === 0) return;
	}

	// rule: prevent loop - ignore if diff is too small
	const volDiff = changes.volume !== undefined ? Math.abs(currentState.config.volume - changes.volume) : 0;
	const speedDiff = changes.speed !== undefined ? Math.abs((currentState.config.speed || 1) - changes.speed) : 0;
	const muteDiff = changes.muted !== undefined ? currentState.config.muted !== changes.muted : false;

	// use previously approved thresholds (1% volume, 0.05 speed)
	if (volDiff < 1 && speedDiff < 0.05 && !muteDiff && Object.keys(changes).length > 0) {
		return;
	}

	log.debug(`[SiteBridge] Auth Sync Accepted:`, changes);
	currentUpdateConfig(changes, options ?? { isNativeSync: true });
}

export function initModeExecutorCallbacks(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	updateBadge: () => void,
	broadcastUI: () => void,
	updateConfig: (changes: Partial<AudioConfig>, options?: { isNativeSync?: boolean }) => void
): () => void {
	currentState = state;
	currentDeps = deps;
	currentUpdateBadge = updateBadge;
	currentBroadcastUI = broadcastUI;
	currentUpdateConfig = updateConfig;

	setNativeVolumeCallback(handleNativeVolume);
	setNativeSpeedCallback(handleNativeSpeed);

	// rule: initialize active site bridge
	const disposeSiteBridge = getSiteBridge().onInitialize({
		updateConfig: handleSiteSyncBack
	});
	return () => {
		disposeSiteBridge();
		if (currentState !== state) return;
		currentState = null;
		currentDeps = null;
		currentUpdateBadge = null;
		currentBroadcastUI = null;
		currentUpdateConfig = null;
	};
}

// post: returns true if the user has engaged with the page, making it safe to initialize AudioContext
export function hasUserGesture(state: PolicyExecutorState): boolean {
	if (state.userHasInteracted || state.hasGesture) return true;

	// rule: active media playback or navigator.userActivation signals implied user intent
	if (isAnyMediaPlaying()) return true;

	const userActivation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
	if (userActivation?.hasBeenActive) return true;

	return false;
}

// eff: orchestrates audio modifications by dispatching to specialized controllers based on activeMode
export function executeMode(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	advanceGeneration = false,
): void {
	const run = executionRun + 1;
	executionRun = run;
	if (advanceGeneration) state.generation += 1;
	void executeModeTransition(deps, state, run, state.generation);
}

async function executeModeTransition(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	run: number,
	generation: number,
): Promise<void> {
	const { audioController, captureManager } = deps;
	const mode = state.activeMode;
	const config = state.config;
	const previousActualMode = state.actualMode;

	// Default speed is transparent. SPECTRA owns playbackRate only while a
	// non-default speed is explicitly stored for this document.
	if (config.speed !== DEFAULT_AUDIO_CONFIG.speed) setSpeed(config.speed);
	else clearTargetSpeed();

	// A pending START owns no acknowledged processor yet, so it cannot be made
	// transparent. Let it settle before bringing up a replacement path; once it
	// becomes active the normal handoff below first applies a unity config. This
	// prevents a delayed START from overlapping WebAudio/DOM or surviving disable.
	if (captureManager.isPending()) {
		await captureManager.waitForSettled();
		if (run !== executionRun) return;
	}

	if (mode === AudioMode.CAPTURE) {
		// Make the page-owned path transparent before tab capture begins. In
		// particular, leaving a DOM attenuation in place would apply gain twice.
		notifyWebAudioState(false);
		audioController.cleanup();
		releaseVolumeLock();
		if (captureManager.isActive()) {
			// note: capture mode targets the offscreen document; domestic volume locks are released
			releaseVolumeLock();
			state.phase = 'starting';
			const synced = await captureManager.syncConfig(config, generation);
			if (run !== executionRun) return;
			state.generation = Math.max(state.generation, captureManager.getGeneration());
			state.actualMode = 'capture';
			state.phase = synced ? 'active' : 'error';
			if (synced) state.appliedConfig = cloneAudioConfig(config);
			state.lastError = synced ? undefined : captureManager.getLastError();
			// note: capture-manager will notify injector via SPECTRA_CAPTURE_STATE
		} else if (hasUserGesture(state)) {
			// log: requesting capture upgrade due to user interaction in capture-eligible mode
			log.capture('Strategy suggests CAPTURE and gesture detected, requesting...');
			state.phase = 'starting';
			const result = await captureManager.request(true, config, generation);
			if (run !== executionRun) return;
			if (result.phase === 'active') {
				state.generation = result.generation ?? run;
				releaseVolumeLock();
				state.actualMode = 'capture';
				state.phase = 'active';
				state.appliedConfig = cloneAudioConfig(config);
				state.lastError = undefined;
			} else {
				// Restore the last acknowledged path when capture startup fails.
				if (previousActualMode === 'webaudio' && await audioController.initialize(true)) {
					applyWebAudioState(config, deps);
					notifyWebAudioState(true);
					state.actualMode = 'webaudio';
					state.appliedConfig = cloneAudioConfig(config);
				} else {
					fallbackToDom(config);
					state.actualMode = 'bypass';
					state.appliedConfig = toDomAppliedConfig(config);
				}
				state.phase = 'error';
				state.lastError = result.error;
			}
		} else {
			fallbackToDom(config);
			state.actualMode = 'bypass';
			state.phase = 'idle';
			state.appliedConfig = toDomAppliedConfig(config);
		}

	} else if (mode === AudioMode.DISABLED) {
		if (captureManager.isActive() || captureManager.isPending()) {
			if (captureManager.isActive() && !await captureManager.syncConfig(transparentAudioConfig(), generation)) {
				state.actualMode = 'capture';
				state.phase = 'error';
				state.lastError = captureManager.getLastError();
				currentUpdateBadge?.();
				currentBroadcastUI?.();
				return;
			}
			if (run !== executionRun) return;
			notifyWebAudioState(false);
			audioController.cleanup();
			releaseVolumeLock();
			state.phase = 'stopping';
			const result = await captureManager.request(false, config, generation);
			if (run !== executionRun) return;
			state.generation = result.generation ?? run;
			if (result.status === 'error' && result.active) {
				// The retained capture processor was acknowledged transparent before
				// shutdown. Playback is therefore bypass, even though its lease remains
				// alive for a retry.
				state.actualMode = 'bypass';
				state.phase = 'error';
				state.appliedConfig = transparentAudioConfig();
				state.lastError = result.error;
				currentUpdateBadge?.();
				currentBroadcastUI?.();
				return;
			}
		}
		notifyWebAudioState(false);
		audioController.cleanup();
		releaseVolumeLock();
		state.actualMode = 'bypass';
		state.phase = 'idle';
		state.appliedConfig = transparentAudioConfig();
		state.lastError = undefined;
	} else if (mode === AudioMode.NATIVE_LITE) {
		if (captureManager.isActive() || captureManager.isPending()) {
			if (captureManager.isActive() && !await captureManager.syncConfig(transparentAudioConfig(), generation)) {
				state.actualMode = 'capture';
				state.phase = 'error';
				state.lastError = captureManager.getLastError();
				currentUpdateBadge?.();
				currentBroadcastUI?.();
				return;
			}
			if (run !== executionRun) return;
			// Bring the replacement path up before releasing capture.
			notifyWebAudioState(false);
			audioController.cleanup();
			fallbackToDom(config);
			state.phase = 'stopping';
			const result = await captureManager.request(false, config, generation);
			if (run !== executionRun) return;
			state.generation = result.generation ?? run;
			if (result.status === 'error' && result.active) {
				// DOM is the applied path; the retained capture graph is unity-only.
				state.actualMode = 'bypass';
				state.phase = 'error';
				state.appliedConfig = toDomAppliedConfig(config);
				state.lastError = result.error;
				currentUpdateBadge?.();
				currentBroadcastUI?.();
				return;
			}
		}
		notifyWebAudioState(false); // exiting WEBAUDIO mode
		audioController.cleanup();
		// mode: strictly uses DOM volume overrides and setter-redirection via 'enableVolumeLock'
		const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
		enableVolumeLock(domVol, config.muted);
		// rule: sync YouTube native UI
		getSiteBridge().syncVolume(config.volume, config.muted);
		state.actualMode = 'bypass';
		state.phase = 'idle';
		state.appliedConfig = toDomAppliedConfig(config);

	} else if (mode === AudioMode.NATIVE_WEBAUDIO) {
		const handingOffCapture = captureManager.isActive() || captureManager.isPending();
		if (captureManager.isActive() && !await captureManager.syncConfig(transparentAudioConfig(), generation)) {
			state.actualMode = 'capture';
			state.phase = 'error';
			state.lastError = captureManager.getLastError();
			currentUpdateBadge?.();
			currentBroadcastUI?.();
			return;
		}
		if (run !== executionRun) return;

		if (hasUserGesture(state)) {
			// rule: always attempt to initialize or resume the context if we have a gesture
			// this handles cases where it's 'ready' but suspended
			state.phase = 'starting';
			const success = await audioController.initialize(true);
			if (run !== executionRun) return;
			if (success) {
				notifyWebAudioState(true); // entering/active in WEBAUDIO mode
				applyWebAudioState(config, deps);
				if (handingOffCapture) {
					const result = await captureManager.request(false, config, generation);
					if (run !== executionRun) return;
					state.generation = result.generation ?? run;
					if (result.status === 'error' && result.active) {
						// WebAudio is already confirmed and capture was switched to unity.
						state.actualMode = 'webaudio';
						state.phase = 'error';
						state.appliedConfig = cloneAudioConfig(config);
						state.lastError = result.error;
						currentUpdateBadge?.();
						currentBroadcastUI?.();
						return;
					}
				}
				state.actualMode = 'webaudio';
				state.phase = 'active';
				state.appliedConfig = cloneAudioConfig(config);
				state.lastError = undefined;
			} else {
				notifyWebAudioState(false);
				if (captureManager.isActive()) {
					const restored = await captureManager.syncConfig(config, generation);
					state.actualMode = 'capture';
					state.appliedConfig = restored
						? cloneAudioConfig(config)
						: transparentAudioConfig();
				} else {
					log.debug('WebAudio resume/init failed -> fallback to DOM');
					fallbackToDom(config);
					state.actualMode = 'bypass';
					state.appliedConfig = toDomAppliedConfig(config);
				}
				state.phase = 'error';
				state.lastError = 'Unable to start WebAudio';
			}
		} else {
			notifyWebAudioState(false);
			fallbackToDom(config);
			state.actualMode = 'bypass';
			state.phase = 'idle';
			state.appliedConfig = toDomAppliedConfig(config);
		}
	}

	if (run === executionRun) {
		currentUpdateBadge?.();
		currentBroadcastUI?.();
	}
}

function transparentAudioConfig(): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
	};
}

function cloneAudioConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

// post: describes only controls the native media-element path can implement.
// Unsupported DSP fields are neutral so snapshots never claim an EQ/boost that
// a capture/WebAudio startup failure did not apply.
export function toDomAppliedConfig(config: AudioConfig): AudioConfig {
	return {
		...config,
		volume: Math.max(0, Math.min(100, config.volume)),
		compressor: false,
		mono: false,
		bass: false,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		pan: 0,
		delay: 0,
	};
}

// post: compensates for the DOM attenuation owned by SPECTRA so every media
// graph has the same effective output, including elements inserted by an SPA.
export function toWebAudioProcessingConfig(config: AudioConfig): AudioConfig {
	const domVolume = config.muted ? 0 : Math.min(1, config.volume / 100);
	const effectiveVolume = !config.muted && domVolume > 0.001
		? (config.volume / 100) / domVolume * 100
		: config.volume;
	return { ...config, volume: effectiveVolume };
}

// eff: applies WebAudio processing while maintaining visual sync with native volume slider
// theory: for <= 100%, we let DOM handle attenuation (visual sync). For > 100%, we lock DOM to 100% and apply boost via WebAudio.
function applyWebAudioState(config: AudioConfig, deps: PolicyExecutorDeps): void {
	const { audioController } = deps;
	const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);

	// rule: calculate effective gain for WebAudio to compensate for DOM attenuation
	// ex: Vol 50% -> Dom 0.5 -> Effective 100% (Unity Gain). Output = 0.5 * 1.0 = 0.5
	// ex: Vol 200% -> Dom 1.0 -> Effective 200% (2.0 Gain). Output = 1.0 * 2.0 = 2.0
	const effectiveConfig = toWebAudioProcessingConfig(config);

	setDomVolume(domVol, config.muted);
	getSiteBridge().syncVolume(config.volume, config.muted);

	audioController.scanAndAttach();
	audioController.updateParams(effectiveConfig);

	// eff: notify injector for WebAudio API hijacking (for sites creating their own contexts)
	// note: we broadcast the REAL requested volume, not the effective one, so hijacked contexts know the target
	window.postMessage({ type: 'SPECTRA_VOLUME_UPDATE', volume: config.volume / 100 }, '*');
}


// eff: basic DOM-based volume control used as a baseline or fallback
// rule: numeric gain is capped at 100% as native HTMLMediaElement doesn't support boost
function fallbackToDom(config: AudioConfig): void {
	const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
	enableVolumeLock(domVol, config.muted);
	getSiteBridge().syncVolume(config.volume, config.muted);
}
