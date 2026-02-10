// goal: manages DOM-based volume control by intercepting native volume setters and applying plugin settings
// role: provides a lightweight fallback for volume control without WebAudio overhead

import { createLogger } from '../../shared/logger';

const log = createLogger('DOMVolume');

// inv: global volume state (0-1 range)
let targetVolume = 1;
let targetMuted = false;
let isLocked = false;
let isDirectTake = false;

// inv: user interaction tracking
let userHasInteracted = false;

// inv: native volume change callbacks
let onNativeVolumeChange: ((v: number, m: boolean) => void) | null = null;
let onNativeSpeedChange: ((s: number) => void) | null = null;

// eff: mark that user has interacted with the page
export function markUserInteracted(): void {
	userHasInteracted = true;
}

// eff: check if user has interacted
export function hasUserInteracted(): boolean {
	return userHasInteracted;
}

// eff: enable direct take mode (native changes go straight to plugin)
export function enableDirectTake(): void {
	isDirectTake = true;
}

// eff: register callback for native volume changes
export function setNativeVolumeCallback(cb: ((v: number, m: boolean) => void) | null): void {
	onNativeVolumeChange = cb;
}

// eff: register callback for native speed changes
export function setNativeSpeedCallback(cb: ((s: number) => void) | null): void {
	onNativeSpeedChange = cb;
}

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

// eff: apply volume to all media elements
function applyVolume(vol: number, muted: boolean): void {
	const videos = document.getElementsByTagName('video');
	const audios = document.getElementsByTagName('audio');

	for (let i = 0; i < videos.length; i++) {
		const v = videos[i];
		if (!v) continue;
		if (Math.abs(v.volume - vol) > 0.001) v.volume = vol;
		if (v.muted !== muted) v.muted = muted;
	}
	for (let i = 0; i < audios.length; i++) {
		const a = audios[i];
		if (!a) continue;
		if (Math.abs(a.volume - vol) > 0.001) a.volume = vol;
		if (a.muted !== muted) a.muted = muted;
	}
}

// eff: set volume directly (bypasses lock)
export function setDomVolume(vol: number, muted: boolean): void {
	targetVolume = vol;
	targetMuted = muted;
	applyVolume(vol, muted);
}

// eff: enable volume lock - intercepts native setters
export function enableVolumeLock(vol: number, muted: boolean): void {
	targetVolume = vol;
	targetMuted = muted;
	isLocked = true;
	applyVolume(vol, muted);
	startMonitoring();
}

// eff: release volume lock
export function releaseVolumeLock(): void {
	isLocked = false;
}

// inv: monitoring state
let isMonitoring = false;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastVideoCount = 0;
let lastAudioCount = 0;

// eff: start monitoring media elements
function startMonitoring(): void {
	if (isMonitoring) return;
	isMonitoring = true;

	// eff: periodically check for new media elements
	monitorInterval = setInterval(() => {
		const videos = document.getElementsByTagName('video');
		const audios = document.getElementsByTagName('audio');

		// rule: if new media elements appeared, apply volume to them
		if (videos.length !== lastVideoCount || audios.length !== lastAudioCount) {
			lastVideoCount = videos.length;
			lastAudioCount = audios.length;
			if (isLocked) {
				applyVolume(targetVolume, targetMuted);
			}
		}
	}, 500);
}

// eff: stop monitoring
export function stopMonitoring(): void {
	isMonitoring = false;
	if (monitorInterval) {
		clearInterval(monitorInterval);
		monitorInterval = null;
	}
}

// eff: ensure monitoring is active
export function ensureMonitoring(): void {
	if (!isMonitoring && isLocked) {
		startMonitoring();
	}
}

// eff: hijack native volume setters to enforce plugin control
function hijackVolumeSetters(): void {
	const originalVolumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
	const originalMutedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');

	if (!originalVolumeDescriptor || !originalMutedDescriptor) return;

	// eff: hijack volume setter
	Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
		get() {
			return originalVolumeDescriptor.get?.call(this) ?? 1;
		},
		set(value: number) {
			// rule: in direct take mode, pass through and notify plugin
			if (isDirectTake && onNativeVolumeChange) {
				const oldVol = originalVolumeDescriptor.get?.call(this) ?? 1;
				originalVolumeDescriptor.set?.call(this, value);
				if (Math.abs(oldVol - value) > 0.001) {
					onNativeVolumeChange(value, this.muted);
				}
				return;
			}

			// rule: if locked, enforce target volume but allow reads
			if (isLocked) {
				// eff: only update if significantly different to avoid loops
				const current = originalVolumeDescriptor.get?.call(this) ?? 1;
				if (Math.abs(current - targetVolume) > 0.001) {
					originalVolumeDescriptor.set?.call(this, targetVolume);
				}
				// note: notify plugin of native attempt
				if (Math.abs(value - targetVolume) > 0.05 && onNativeVolumeChange) {
					onNativeVolumeChange(value, this.muted);
				}
			} else {
				originalVolumeDescriptor.set?.call(this, value);
			}
		},
		configurable: true
	});

	// eff: hijack muted setter
	Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
		get() {
			return originalMutedDescriptor.get?.call(this) ?? false;
		},
		set(value: boolean) {
			// rule: in direct take mode, pass through and notify plugin
			if (isDirectTake && onNativeVolumeChange) {
				const oldMuted = originalMutedDescriptor.get?.call(this) ?? false;
				originalMutedDescriptor.set?.call(this, value);
				if (oldMuted !== value) {
					onNativeVolumeChange(-1, value);
				}
				return;
			}

			// rule: if locked, enforce target muted state
			if (isLocked) {
				const current = originalMutedDescriptor.get?.call(this) ?? false;
				if (current !== targetMuted) {
					originalMutedDescriptor.set?.call(this, targetMuted);
				}
				// note: notify plugin of native attempt
				if (value !== targetMuted && onNativeVolumeChange) {
					onNativeVolumeChange(-1, value);
				}
			} else {
				originalMutedDescriptor.set?.call(this, value);
			}
		},
		configurable: true
	});
}

// eff: hijack playbackRate setter for speed sync
function hijackPlaybackRate(): void {
	const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
	if (!originalDescriptor) return;

	Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
		get() {
			return originalDescriptor.get?.call(this) ?? 1;
		},
		set(value: number) {
			const oldRate = originalDescriptor.get?.call(this) ?? 1;
			originalDescriptor.set?.call(this, value);

			// rule: notify plugin of speed changes from native UI
			if (Math.abs(oldRate - value) > 0.001 && onNativeSpeedChange) {
				onNativeSpeedChange(value);
			}
		},
		configurable: true
	});
}

// eff: initialize hijacking
hijackVolumeSetters();
hijackPlaybackRate();
