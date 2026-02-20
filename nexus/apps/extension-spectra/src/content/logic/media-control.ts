// goal: provides direct DOM control for playback, picture-in-picture, and playback rate
// role: operations target the "primary" video element (largest visible)

import { createLogger } from '../../shared/logger';
import { simulateMouseHover } from '../utils/focus-helper';
import { isYouTube, setYouTubeSpeed } from '../adapters/youtube-adapter';
import { getElementState } from '../audio/volume-observer';
import { getPrimaryVideo, applyToMedia } from '../utils/media-utils';

const log = createLogger('MediaControl');

export function setSpeed(s: number, pitch?: boolean): { speed: number; preservePitch: boolean } {
	const clamped = Math.max(0.1, Math.min(16, s));
	const p = pitch ?? true;

	if (isYouTube()) setYouTubeSpeed(clamped);
	window.postMessage({ type: 'SPECTRA_TARGET_SPEED', speed: clamped }, '*');

	applyToMedia(m => {
		if (Math.abs(m.playbackRate - clamped) > 0.005) {
			const st = getElementState(m);
			st.settingByPlugin = true;
			m.playbackRate = clamped;
			st.speed = clamped;
			setTimeout(() => { st.settingByPlugin = false; }, 100);
		}
		if ('preservesPitch' in m) (m as any).preservesPitch = p;
	});

	log.info(`Speed ${clamped}x, pitch=${p}`);
	return { speed: clamped, preservePitch: p };
}

export function clearTargetSpeed(): void {
	window.postMessage({ type: 'SPECTRA_CLEAR_TARGET_SPEED' }, '*');
}

export function togglePlay(): boolean {
	const v = getPrimaryVideo();
	if (!v) { log.warn('No video'); return false; }

	if (v.paused) {
		v.play().catch(e => log.error('Play fail:', e));
		return true;
	} else {
		v.pause();
		return false;
	}
}

export async function togglePip(): Promise<boolean> {
	const v = getPrimaryVideo();
	if (!v) { log.warn('No video'); return false; }

	try {
		let r: boolean;
		if (document.pictureInPictureElement === v) {
			await document.exitPictureInPicture();
			r = false;
		} else {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			await v.requestPictureInPicture();
			r = true;
		}
		setTimeout(() => simulateMouseHover(v), 200);
		return r;
	} catch (e) {
		log.error('PiP fail:', e);
		return false;
	}
}

export function adjustSpeed(d: number): { speed: number; preservePitch: boolean } {
	const v = getPrimaryVideo();
	return setSpeed((v?.playbackRate ?? 1) + d);
}

export function getMediaState(): { playing: boolean; speed: number; pipActive: boolean; preservePitch: boolean } {
	const v = getPrimaryVideo();
	const p = v && 'preservesPitch' in v ? (v as any).preservesPitch : true;
	return {
		playing: v ? !v.paused : false,
		speed: v?.playbackRate ?? 1,
		pipActive: document.pictureInPictureElement === v,
		preservePitch: p
	};
}

export function seekVideo(delta: number): number {
	const v = getPrimaryVideo();
	if (!v) { log.warn('No video to seek'); return 0; }
	v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
	return v.currentTime;
}
