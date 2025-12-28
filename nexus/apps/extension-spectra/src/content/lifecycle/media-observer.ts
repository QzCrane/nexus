/**
 * // goal: Detect dynamic media additions
 * // rule: Debounced (500ms) observation of DOM subtree changes
 */

import { AudioMode } from '@nexus/audio-engine';
import { WebAudioController } from '@nexus/audio-engine';
import { isExtensionContextValid } from '../context-guard';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';

/**
 * // eff: Starts MutationObserver
 * // post: Returns cleanup function
 */
export function createMediaObserver(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	policyExecutor: PolicyExecutor
): () => void {
	let observerTimeout: ReturnType<typeof setTimeout> | null = null;

	const observer = new MutationObserver(() => {
		// rule: Stop processing if extension context is invalid

		if (observerTimeout) clearTimeout(observerTimeout);
		observerTimeout = setTimeout(() => {
			// rule: Re-check validity (delayed execution)

			// eff: Trigger CORS probe (internal deduping prevents redundant checks)

			if (state.activeMode === AudioMode.NATIVE_WEBAUDIO) {
				audioController.scanAndAttach();
			}
			policyExecutor.applyState();
		}, 500);
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	// Return cleanup function
	return () => {
		if (observerTimeout) clearTimeout(observerTimeout);
		observer.disconnect();
	};
}

/**
 * // inv: true if any audio/video tag exists
 */
export function hasMediaElements(): boolean {
	const audioCount = document.querySelectorAll('audio').length;
	const videoCount = document.querySelectorAll('video').length;
	return audioCount > 0 || videoCount > 0;
}
