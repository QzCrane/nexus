// goal: install exactly one versioned MAIN-world runtime per page

import { hijackPlaybackRate } from './playback-rate';
import { enforceCORS } from './cors-enforcer';
import { initWebAudioHijack } from './webaudio-hijack';
import { initYouTubeAdapter } from './youtube-adapter';
import { initMessageBridge } from './message-bridge';

interface MainRuntime {
	revision: string;
	dispose(): void;
}

interface SpectraMainWindow extends Window {
	__SPECTRA_MAIN_RUNTIME__?: MainRuntime;
}

const RUNTIME_REVISION = '2.0.1';
const host = window as SpectraMainWindow;
const previous = host.__SPECTRA_MAIN_RUNTIME__;

if (!previous || previous.revision !== RUNTIME_REVISION) {
	previous?.dispose();
	const disposers: Array<() => void> = [
		initWebAudioHijack(),
		initMessageBridge(),
		hijackPlaybackRate(),
		enforceCORS(),
		initYouTubeAdapter(),
	];

	host.__SPECTRA_MAIN_RUNTIME__ = {
		revision: RUNTIME_REVISION,
		dispose() {
			for (let index = disposers.length - 1; index >= 0; index--) {
				try { disposers[index]?.(); } catch { /* page may already be unloading */ }
			}
		},
	};
}
