// goal: sync YouTube's official #movie_player.getVolume() to a data attribute
// so the ISOLATED-world native-media-executor reads the user-facing volume
// instead of the non-linear element.volume curve YouTube applies internally.
//
// This bridge is registered in manifest.json as a MAIN-world content script
// matching *://*.youtube.com/* so Chrome injects it at document_start before
// YouTube's player code runs. The V1 guard makes warm-update re-injection a
// no-op, coexisting safely with the manifest entry.

import { SPECTRA_YOUTUBE_VOLUME_ATTRIBUTE } from '../../shared/youtube-volume-bridge';

interface MainYouTubeWindow extends Window {
	__SPECTRA_YOUTUBE_VOLUME_BRIDGE_V1__?: true;
}

interface YouTubePlayer extends Element {
	getVolume?(): number;
}

function readOfficialVolume(): number | null {
	const player = document.querySelector('#movie_player') as YouTubePlayer | null;
	if (!player?.getVolume) return null;
	try {
		const volume = player.getVolume();
		return Number.isFinite(volume) && volume >= 0 && volume <= 100 ? volume : null;
	} catch {
		return null;
	}
}

function syncVolumeAttribute(): void {
	const volume = readOfficialVolume();
	const root = document.documentElement;
	if (!root) return;
	if (volume !== null) {
		root.setAttribute(SPECTRA_YOUTUBE_VOLUME_ATTRIBUTE, String(volume));
	} else {
		root.removeAttribute(SPECTRA_YOUTUBE_VOLUME_ATTRIBUTE);
	}
}

const mainWindow = window as MainYouTubeWindow;
if (!mainWindow.__SPECTRA_YOUTUBE_VOLUME_BRIDGE_V1__) {
	mainWindow.__SPECTRA_YOUTUBE_VOLUME_BRIDGE_V1__ = true;

	// YouTube's player updates #movie_player before volumechange fires, so a
	// microtask-deferred sync captures the official user-facing volume.
	document.addEventListener('volumechange', () => {
		queueMicrotask(syncVolumeAttribute);
	}, true);

	// Poll to catch the player loading (async) and programmatic volume changes
	// that don't fire volumechange (e.g., ad transitions, SPA navigation).
	// Fast at first to minimize the window where element.volume's non-linear
	// curve leaks through, then slower once the player is confirmed available.
	let slowPoll = false;
	const poll = (): void => {
		syncVolumeAttribute();
		if (document.documentElement?.hasAttribute(SPECTRA_YOUTUBE_VOLUME_ATTRIBUTE)) {
			slowPoll = true;
		}
		setTimeout(poll, slowPoll ? 2000 : 250);
	};
	setTimeout(poll, 100);
}
