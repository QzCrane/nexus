// goal: provides direct DOM control for playback, picture-in-picture, and playback rate
// role: operations target the "primary" video element (largest visible)
// perf: cached media elements, batched updates, inline calculations

import { createLogger } from '../../shared/logger';
import { simulateMouseHover } from '../utils/focus-helper';
import { isYouTube, setYouTubeSpeed } from '../adapters/youtube-adapter';
import { getElementState } from '../audio/volume-observer';
import { getPrimaryVideo } from '../utils/media-utils';

const log = createLogger('MediaControl');

// perf: cached media elements to avoid repeated DOM queries
let mediaCache: HTMLMediaElement[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 100; // ms

// eff: get cached media elements with TTL
const getCachedMedia = (): HTMLMediaElement[] => {
	const now = performance.now();
	if (now - cacheTimestamp > CACHE_TTL || mediaCache.length === 0) {
		const videos = document.getElementsByTagName('video');
		const audios = document.getElementsByTagName('audio');
		const totalLen = videos.length + audios.length;

		// perf: pre-allocate array
		mediaCache = new Array(totalLen);
		let idx = 0;

		// eff: inline loop for better performance
		for (let i = 0, l = videos.length; i < l; i++) {
			const v = videos[i];
			if (v) mediaCache[idx++] = v;
		}
		for (let i = 0, l = audios.length; i < l; i++) {
			const a = audios[i];
			if (a) mediaCache[idx++] = a;
		}

		cacheTimestamp = now;
	}
	return mediaCache;
};

// perf: batch speed updates with requestAnimationFrame
let pendingSpeed: number | null = null;
let pendingPitch: boolean | null = null;
let rafId: number | null = null;

const flushSpeedUpdates = (): void => {
	if (pendingSpeed === null) return;

	const speed = pendingSpeed;
	const pitch = pendingPitch ?? true;
	const threshold = 0.005;

	const media = getCachedMedia();
	const len = media.length;

	// eff: single pass apply to all media
	for (let i = 0; i < len; i++) {
		const m = media[i];
		if (!m) continue;

		// perf: inline diff calculation
		const diff = m.playbackRate - speed;
		if (diff > threshold || diff < -threshold) {
			const st = getElementState(m);
			st.settingByPlugin = true;
			m.playbackRate = speed;
			st.speed = speed;
			// perf: use queueMicrotask for faster cleanup
			queueMicrotask(() => { st.settingByPlugin = false; });
		}

		if ('preservesPitch' in m) {
			(m as any).preservesPitch = pitch;
		}
	}

	pendingSpeed = null;
	pendingPitch = null;
};

const scheduleSpeedUpdate = (speed: number, pitch?: boolean): void => {
	pendingSpeed = speed;
	pendingPitch = pitch ?? null;
	if (rafId !== null) return;
	rafId = requestAnimationFrame(() => {
		rafId = null;
		flushSpeedUpdates();
	});
};

export function setSpeed(s: number, pitch?: boolean): { speed: number; preservePitch: boolean } {
	const clamped = Math.max(0.1, Math.min(16, s));
	const p = pitch ?? true;

	// eff: YouTube special handling
	if (isYouTube()) setYouTubeSpeed(clamped);

	// eff: notify injector to apply speed
	window.postMessage({ type: 'SPECTRA_TARGET_SPEED', speed: clamped }, '*');

	// perf: schedule batched update
	scheduleSpeedUpdate(clamped, p);

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
