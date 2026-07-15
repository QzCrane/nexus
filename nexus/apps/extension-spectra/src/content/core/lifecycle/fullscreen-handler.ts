// goal: keep fullscreen lifecycle observable without mutating audio state

import type { PolicyExecutorState } from '../../types';
import type { CaptureManager } from '../../audio/capture-manager';
import type { PolicyExecutor } from '../../logic/policy-executor/types';

export function setupFullscreenHandler(
	_state: PolicyExecutorState,
	executor: PolicyExecutor,
	_captureManager: CaptureManager,
	config: { enabled?: boolean } = {},
): () => void {
	if (config.enabled === false) return () => { };
	const handleFullscreenChange = () => {
		// Fullscreen must never stop capture, close AudioContext, force volume, or unmute.
		// Re-applying the desired state is safe and handles sites that replace media nodes.
		executor.applyState();
	};
	document.addEventListener('fullscreenchange', handleFullscreenChange);
	document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
	return () => {
		document.removeEventListener('fullscreenchange', handleFullscreenChange);
		document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
	};
}
