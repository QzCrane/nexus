// goal: YouTube-specific speed sync to update native UI
// role: complements universal hijacking by calling YouTube's internal API
// note: YouTube API is only accessible in MAIN world, so we use postMessage to communicate with injector

import { createLogger } from '../../shared/logger';

const log = createLogger('YTAdapter');

// inv: pending rate to apply when injector confirms
let pendingRate: number | null = null;
let lastSentRate: number | null = null;

// eff: check if current page is YouTube
export function isYouTube(): boolean {
	return location.hostname.includes('youtube.com') ||
		location.hostname.includes('youtu.be');
}

// eff: set speed via YouTube API through injector
// note: injector runs in MAIN world and can access YouTube's player API
export function setYouTubeSpeed(rate: number): boolean {
	// Skip if same as last sent (avoid loops)
	if (lastSentRate !== null && Math.abs(lastSentRate - rate) < 0.005) {
		return true;
	}

	// Send message to injector
	log.info(`Requesting YT speed sync: ${rate}x`);
	window.postMessage({ type: 'SPECTRA_YT_SPEED', speed: rate }, '*');
	lastSentRate = rate;
	return true;
}

// eff: listen for injector responses
export function initYouTubeAdapter(): void {
	window.addEventListener('message', (event) => {
		if (!event.data) return;

		if (event.data.type === 'SPECTRA_YT_SPEED_OK') {
			log.info(`YT UI synced: ${event.data.speed}x`);
		}

		if (event.data.type === 'SPECTRA_YT_SPEED_FAIL') {
			log.warn('YT speed sync failed:', event.data.error);
			lastSentRate = null; // Reset to allow retry
		}
	});
}

// eff: clear cached state
export function clearYouTubeCache(): void {
	pendingRate = null;
	lastSentRate = null;
}
