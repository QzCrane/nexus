/**
 * // goal: Unlock AudioContext via user gestures and track popup connection
 * // risk: Missing interaction event prevents audio start in strict autoplay policies
 */

import { AudioMode, WebAudioController } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';

const log = logger.content;

/**
 * // goal: Unlock WebAudio on first interaction
 * // eff: Adds one-time event listeners to document
 */
export function setupUserGestureListeners(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	policyExecutor: PolicyExecutor
): void {
	const handleUserGestureUnlock = () => {
		if (state.activeMode === AudioMode.NATIVE_WEBAUDIO && !audioController.isReady()) {
			log.debug('User gesture detected, retrying WebAudio init.');
			policyExecutor.applyState();
		}
	};

	const interactionEvents = ['click', 'keydown', 'touchstart', 'mousedown'];
	interactionEvents.forEach(event => {
		document.addEventListener(event, handleUserGestureUnlock, { once: true, passive: true });
	});
}

/**
 * // goal: Track popup visibility state
 * // eff: Updates state.isPopupOpen on connect/disconnect
 */
export function setupPopupConnectionListener(state: PolicyExecutorState): void {
	chrome.runtime.onConnect.addListener((port) => {
		if (port.name === 'popup-connection') {
			state.isPopupOpen = true;
			port.onDisconnect.addListener(() => {
				state.isPopupOpen = false;
			});
		}
	});
}
