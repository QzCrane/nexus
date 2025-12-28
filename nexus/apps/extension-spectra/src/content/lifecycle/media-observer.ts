// goal: provides real-time detection of dynamic media element additions via DOM mutation monitoring
// rule: uses a 500ms debounce to prevent performance degradation during rapid DOM updates

import { AudioMode } from '@nexus/audio-engine';
import { WebAudioController } from '@nexus/audio-engine';
import { isExtensionContextValid } from '../context-guard';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';

// eff: initializes a MutationObserver on the document root and triggers state re-application upon change detection
// post: returns a cleanup function to disconnect the observer and clear pending timeouts
export function createMediaObserver(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	policyExecutor: PolicyExecutor
): () => void {
	let observerTimeout: ReturnType<typeof setTimeout> | null = null;

	const observer = new MutationObserver(() => {
		// rule: execution is halted if the extension context becomes invalid (e.g. extension updated/reloaded)
		if (observerTimeout) clearTimeout(observerTimeout);
		observerTimeout = setTimeout(() => {
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

	return () => {
		if (observerTimeout) clearTimeout(observerTimeout);
		observer.disconnect();
	};
}

// inv: returns true if at least one <audio> or <video> element exists in the current document
export function hasMediaElements(): boolean {
	const audioCount = document.querySelectorAll('audio').length;
	const videoCount = document.querySelectorAll('video').length;
	return audioCount > 0 || videoCount > 0;
}
