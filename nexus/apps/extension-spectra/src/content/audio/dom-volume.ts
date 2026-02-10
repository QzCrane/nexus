// goal: Sync DOM media volume with plugin state

import { logger } from '../../shared/logger';
import { getElementState, isMonitored, markMonitored, setupVolumeMonitor, type MonitorContext } from './volume-observer';

const log = logger.content;
let targetVolume = 1, targetMuted = false;
let syncEnabled = true, userInteracted = false;
let onNativeVolumeChange: ((v: number, m: boolean) => void) | null = null;
let onNativeSpeedChange: ((s: number) => void) | null = null;
let onVolumeApplied: ((v: number, m: boolean) => void) | null = null;

// inv: pending volume to apply when media becomes available
let pendingVolume: number | null = null;
let pendingMuted: boolean | null = null;
let volumeObserver: MutationObserver | null = null;

export const markUserInteracted = () => { userInteracted = true; };
export const hasUserInteracted = () => userInteracted;
export const setNativeVolumeCallback = (cb: (v: number, m: boolean) => void) => { onNativeVolumeChange = cb; };
export const setNativeSpeedCallback = (cb: (s: number) => void) => { onNativeSpeedChange = cb; };
export const setVolumeAppliedCallback = (cb: (v: number, m: boolean) => void) => { onVolumeApplied = cb; };

// eff: Static context object to avoid closure allocation per element
const ctx: MonitorContext = {
	getUserInteracted: () => userInteracted,
	isSyncEnabled: () => syncEnabled,
	getTargetVolume: () => targetVolume,
	getTargetMuted: () => targetMuted,
	onNativeVolumeChange: (v, m) => onNativeVolumeChange?.(v, m),
	onNativeSpeedChange: (s) => onNativeSpeedChange?.(s),
};

// eff: check if any media elements exist
function hasMediaElements(): boolean {
	return document.getElementsByTagName('video').length > 0 ||
		document.getElementsByTagName('audio').length > 0;
}

// eff: start observing for media elements and apply pending volume
function startVolumeObserver(): void {
	if (volumeObserver) return;

	volumeObserver = new MutationObserver(() => {
		if (hasMediaElements()) {
			ensureMonitoring();
			if (pendingVolume !== null) {
				const vol = pendingVolume;
				const muted = pendingMuted ?? false;
				applyVolume(vol, muted);
				// eff: notify external (e.g., YouTube sync)
				onVolumeApplied?.(vol, muted);
				pendingVolume = null;
				pendingMuted = null;
				log.debug(`[DOM] Vol ${(vol * 100) | 0}% applied (media now available)`);
			}
			volumeObserver?.disconnect();
			volumeObserver = null;
		}
	});

	volumeObserver.observe(document.body, { childList: true, subtree: true });

	// timeout to cleanup observer
	setTimeout(() => {
		volumeObserver?.disconnect();
		volumeObserver = null;
	}, 10000);
}

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

// eff: apply volume to all media elements
function applyVolume(vol: number, muted: boolean): number {
	const videos = document.getElementsByTagName('video');
	const audio = document.getElementsByTagName('audio');
	let applied = 0;

	const apply = (m: HTMLMediaElement) => {
		if (Math.abs(m.volume - vol) < 0.005 && m.muted === muted) return;

		const s = getElementState(m);
		s.volume = vol; s.muted = muted; s.settingByPlugin = true;

		try { m.volume = vol; m.muted = muted; applied++; } catch { }

		// eff: clear flag asynchronously
		setTimeout(() => { s.settingByPlugin = false; }, 100);
	};

	for (let i = 0, l = videos.length; i < l; i++) apply(videos[i]!);
	for (let i = 0, l = audio.length; i < l; i++) apply(audio[i]!);

	return applied;
}

export function setDomVolume(vol: number, muted: boolean): void {
	if (Math.abs(targetVolume - vol) < 0.005 && targetMuted === muted) return;

	targetVolume = vol;
	targetMuted = muted;

	// eff: if no media elements, queue for later application
	if (!hasMediaElements()) {
		pendingVolume = vol;
		pendingMuted = muted;
		startVolumeObserver();
		log.debug(`[DOM] Vol ${(vol * 100) | 0}% queued (no media yet)`);
		return;
	}

	ensureMonitoring();
	const applied = applyVolume(vol, muted);
	if (applied) log.debug(`[DOM] Vol Applied: ${(vol * 100) | 0}% -> ${applied}`);
}

export function releaseVolumeLock(): void {
	syncEnabled = false; targetVolume = 1; targetMuted = false;
	pendingVolume = null;
	pendingMuted = null;
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
export { isAnyMediaPlaying, hasMediaElements } from './media-detection';
export { getPausedAt } from '../utils/pause-tracker';
