// goal: tracks silence duration by monitoring media pause timestamps for domain-agnostic pause retention logic

import { getContentBootstrapState } from '../../shared/content-runtime';

// pausedAt: epoch timestamp (ms) when all media stopped playing; null if any media is active
let pausedAt: number | null = null;

export function getPausedAt(): number | null {
	const bootstrap = getContentBootstrapState();
	return bootstrap?.mediaPausedAt === undefined ? pausedAt : bootstrap.mediaPausedAt;
}

// eff: updates the global pause timestamp based on aggregate playback state
export function updatePausedAt(hasPlaying: boolean, hasElements: boolean): void {
	pausedAt = getPausedAt();
	if (hasPlaying) {
		pausedAt = null;
	} else if (pausedAt === null && hasElements) {
		pausedAt = Date.now();
	} else if (!hasElements) {
		pausedAt = null;
	}
	const bootstrap = getContentBootstrapState();
	if (bootstrap) bootstrap.mediaPausedAt = pausedAt;
}
