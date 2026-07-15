// goal: validate and centralize isolated-world to MAIN-world control messages

import { setWebAudioEnhancementActive, updateVolume } from './webaudio-hijack';

export function initMessageBridge(): () => void {
	const listener = (event: MessageEvent) => {
		if (event.source !== window || !event.data || typeof event.data.type !== 'string') return;
		switch (event.data.type) {
			case 'SPECTRA_VOLUME_UPDATE':
				if (typeof event.data.volume === 'number') updateVolume(event.data.volume);
				break;
			case 'SPECTRA_WEBAUDIO_STATE':
				setWebAudioEnhancementActive(event.data.active === true);
				break;
			default:
				break;
		}
	};
	window.addEventListener('message', listener);
	return () => window.removeEventListener('message', listener);
}
