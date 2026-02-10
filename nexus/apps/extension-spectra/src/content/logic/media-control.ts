// goal: provides direct DOM control for playback, picture-in-picture, and playback rate
// role: operations target the "primary" video element (largest visible)

import { createLogger } from '../../shared/logger';
import { simulateMouseHover } from '../utils/focus-helper';
import { isYouTube, setYouTubeSpeed } from '../adapters/youtube-adapter';

const log = createLogger('MediaControl');

// inv: pending speed to apply when media becomes available
let pendingSpeed: number | null = null;
let pendingPitch: boolean | null = null;
let mediaObserver: MutationObserver | null = null;

// eff: single pass O(N) zero-alloc
function getPrimaryVideo(): HTMLVideoElement | null {
	const v = document.getElementsByTagName('video');
	let best: HTMLVideoElement | null = null;
	let maxA = 0;

	for (let i = 0, l = v.length; i < l; i++) {
		const el = v[i];
		if (!el) continue;
		const rect = el.getBoundingClientRect();
		const a = rect.width * rect.height;
		if (a > maxA) { maxA = a; best = el; }
	}
	return best || (v.length > 0 ? v[0]! : null);
}

// eff: check if any media elements exist
function hasMediaElements(): boolean {
	return document.getElementsByTagName('video').length > 0 ||
		document.getElementsByTagName('audio').length > 0;
}

// eff: start observing for media elements and apply pending speed
function startMediaObserver(): void {
	if (mediaObserver) return;

	mediaObserver = new MutationObserver(() => {
		if (hasMediaElements() && pendingSpeed !== null) {
			const speed = pendingSpeed;
			const pitch = pendingPitch ?? true;
			// rule: YouTube also needs API call for queued speed
			if (isYouTube()) {
				setYouTubeSpeed(speed);
			}
			applySpeed(speed, pitch);
			pendingSpeed = null;
			pendingPitch = null;
			mediaObserver?.disconnect();
			mediaObserver = null;
			log.info(`Speed ${speed}x applied (media now available)`);
		}
	});

	mediaObserver.observe(document.body, { childList: true, subtree: true });

	// timeout to cleanup observer
	setTimeout(() => {
		mediaObserver?.disconnect();
		mediaObserver = null;
	}, 10000);
}

// eff: apply speed to all media elements
function applySpeed(clamped: number, p: boolean): void {
	const vs = document.getElementsByTagName('video');
	const as = document.getElementsByTagName('audio');

	const apply = (m: HTMLMediaElement) => {
		if (Math.abs(m.playbackRate - clamped) > 0.005) {
			m.playbackRate = clamped;
		}
		if ('preservesPitch' in m) (m as any).preservesPitch = p;
	};

	for (let i = 0; i < vs.length; i++) { const m = vs[i]; if (m) apply(m); }
	for (let i = 0; i < as.length; i++) { const m = as[i]; if (m) apply(m); }
}

// eff: live collections iteration
// note: playbackRate hijacking in injector enables universal player support
// note: YouTube requires additional API call to sync native UI
export function setSpeed(s: number, pitch?: boolean): { speed: number; preservePitch: boolean } {
	const clamped = Math.max(0.1, Math.min(16, s));
	const p = pitch ?? true;

	// rule: YouTube requires native API call to update its UI
	if (isYouTube()) {
		setYouTubeSpeed(clamped);
	}

	// eff: if no media elements, queue for later application
	if (!hasMediaElements()) {
		pendingSpeed = clamped;
		pendingPitch = p;
		startMediaObserver();
		log.debug(`Speed ${clamped}x queued (no media yet)`);
		return { speed: clamped, preservePitch: p };
	}

	applySpeed(clamped, p);
	log.info(`Speed ${clamped}x, pitch=${p}`);
	return { speed: clamped, preservePitch: p };
}

// eff: force apply speed regardless of last value - used on page load
export function forceApplySpeed(s: number, pitch?: boolean): void {
	const clamped = Math.max(0.1, Math.min(16, s));
	const p = pitch ?? true;

	if (isYouTube()) {
		setYouTubeSpeed(clamped);
	}

	if (!hasMediaElements()) {
		pendingSpeed = clamped;
		pendingPitch = p;
		startMediaObserver();
		log.debug(`Speed ${clamped}x queued (force apply)`);
		return;
	}

	applySpeed(clamped, p);
	log.info(`Speed ${clamped}x force applied, pitch=${p}`);
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

export function seekVideo(delta: number): number {
	const v = getPrimaryVideo();
	if (!v) { log.warn('No video to seek'); return 0; }
	v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
	return v.currentTime;
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
