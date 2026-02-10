// goal: Sync DOM media volume with plugin state
// role: manages DOM-based volume control with event-based monitoring

import { createLogger } from '../../shared/logger';
import { getElementState, isMonitored, markMonitored, setupVolumeMonitor, type MonitorContext } from './volume-observer';
import { isYouTube, setYouTubeVolume } from '../adapters/youtube-adapter';

const log = createLogger('DOMVolume');

let targetVolume = 1, targetMuted = false;
let syncEnabled = true, userInteracted = false;
let onNativeVolumeChange: ((v: number, m: boolean) => void) | null = null;
let onNativeSpeedChange: ((s: number) => void) | null = null;

export const markUserInteracted = () => { userInteracted = true; };
export const hasUserInteracted = () => userInteracted;
export const setNativeVolumeCallback = (cb: (v: number, m: boolean) => void) => { onNativeVolumeChange = cb; };
export const setNativeSpeedCallback = (cb: (s: number) => void) => { onNativeSpeedChange = cb; };

// eff: Static context object to avoid closure allocation per element
const ctx: MonitorContext = {
	getUserInteracted: () => userInteracted,
	isSyncEnabled: () => syncEnabled,
	getTargetVolume: () => targetVolume,
	getTargetMuted: () => targetMuted,
	onNativeVolumeChange: (v, m) => onNativeVolumeChange?.(v, m),
	onNativeSpeedChange: (s) => onNativeSpeedChange?.(s),
};

function ensureMonitoring(): void {
	// eff: live collection
	const videos = document.getElementsByTagName('video');
	const audio = document.getElementsByTagName('audio');

	for (let i = 0, l = videos.length; i < l; i++) {
		const m = videos[i]!;
		if (!isMonitored(m)) { setupVolumeMonitor(m, ctx); markMonitored(m); }
	}
	for (let i = 0, l = audio.length; i < l; i++) {
		const m = audio[i]!;
		if (!isMonitored(m)) { setupVolumeMonitor(m, ctx); markMonitored(m); }
	}
}

export function setDomVolume(vol: number, muted: boolean): void {
	ensureMonitoring();

	// Convert 0-100 to 0-1 if needed
	const normalizedVol = vol > 1 ? vol / 100 : vol;

	if (Math.abs(targetVolume - normalizedVol) < 0.005 && targetMuted === muted) return;

	targetVolume = normalizedVol;
	targetMuted = muted;

	// rule: sync YouTube native UI
	if (isYouTube()) {
		setYouTubeVolume(vol, muted);
	}

	const videos = document.getElementsByTagName('video');
	const audio = document.getElementsByTagName('audio');
	let applied = 0;

	const apply = (m: HTMLMediaElement) => {
		if (Math.abs(m.volume - normalizedVol) < 0.005 && m.muted === muted) return;

		const s = getElementState(m);
		s.volume = normalizedVol; s.muted = muted; s.settingByPlugin = true;

		try { m.volume = normalizedVol; m.muted = muted; applied++; } catch { }

		// eff: clear flag asynchronously
		setTimeout(() => { s.settingByPlugin = false; }, 100);
	};

	for (let i = 0, l = videos.length; i < l; i++) apply(videos[i]!);
	for (let i = 0, l = audio.length; i < l; i++) apply(audio[i]!);

	if (applied) log.debug(`[DOM] Vol Applied: ${(normalizedVol * 100) | 0}% -> ${applied}`);
}

export function releaseVolumeLock(): void {
	syncEnabled = false; targetVolume = 1; targetMuted = false;
	ensureMonitoring();

	const unlock = (m: HTMLMediaElement) => {
		const s = getElementState(m);
		s.settingByPlugin = true;
		try { m.volume = 1; m.muted = false; } catch { }
		setTimeout(() => { s.settingByPlugin = false; }, 100);
	};

	const videos = document.getElementsByTagName('video');
	const audio = document.getElementsByTagName('audio');
	for (let i = 0, l = videos.length; i < l; i++) unlock(videos[i]!);
	for (let i = 0, l = audio.length; i < l; i++) unlock(audio[i]!);
}

export function enableVolumeLock(vol: number, muted: boolean): void {
	syncEnabled = true;
	setDomVolume(vol, muted);
}

export const enableDirectTake = () => { syncEnabled = false; };

// eff: check if any media is currently playing
export function isAnyMediaPlaying(): boolean {
	const videos = document.getElementsByTagName('video');
	const audios = document.getElementsByTagName('audio');

	for (let i = 0; i < videos.length; i++) {
		const v = videos[i];
		if (v && !v.paused && v.currentTime > 0) return true;
	}
	for (let i = 0; i < audios.length; i++) {
		const a = audios[i];
		if (a && !a.paused && a.currentTime > 0) return true;
	}
	return false;
}

// eff: check if any media elements exist
export function hasMediaElements(): boolean {
	return document.getElementsByTagName('video').length > 0 ||
		document.getElementsByTagName('audio').length > 0;
}
