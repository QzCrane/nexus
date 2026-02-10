// goal: manages DOM-based volume control with lazy update strategy
// role: only applies plugin settings on initial load and plugin-initiated changes
//       user interactions with native UI are detected and synced to plugin

import { createLogger } from '../../shared/logger';

const log = createLogger('DOMVolume');

// inv: global volume state (0-1 range) - reflects plugin config
let targetVolume = 1;
let targetMuted = false;

// inv: user interaction tracking
let userHasInteracted = false;

// inv: native volume change callbacks
let onNativeVolumeChange: ((v: number, m: boolean) => void) | null = null;
let onNativeSpeedChange: ((s: number) => void) | null = null;

// inv: track which media elements have been initialized
const initializedElements = new WeakSet<HTMLMediaElement>();

// eff: mark that user has interacted with the page
export function markUserInteracted(): void {
	userHasInteracted = true;
}

// eff: check if user has interacted
export function hasUserInteracted(): boolean {
	return userHasInteracted;
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

// eff: apply volume to a single media element (only if not user-controlled)
function applyVolumeToElement(el: HTMLMediaElement, vol: number, muted: boolean): void {
	// rule: only apply if element hasn't been user-modified
	if (initializedElements.has(el)) {
		// Element already initialized, don't auto-correct user changes
		return;
	}

	// Mark as initialized so we don't override future user changes
	initializedElements.add(el);

	// Apply initial volume
	if (Math.abs(el.volume - vol) > 0.001) {
		el.volume = vol;
	}
	if (el.muted !== muted) {
		el.muted = muted;
	}
}

// eff: set volume from plugin - apply to all uninitialized media elements
export function setDomVolume(vol: number, muted: boolean): void {
	targetVolume = vol;
	targetMuted = muted;

	const videos = document.getElementsByTagName('video');
	const audios = document.getElementsByTagName('audio');

	for (let i = 0; i < videos.length; i++) {
		const v = videos[i];
		if (v) applyVolumeToElement(v, vol, muted);
	}
	for (let i = 0; i < audios.length; i++) {
		const a = audios[i];
		if (a) applyVolumeToElement(a, vol, muted);
	}
}

// eff: enable volume monitoring - only initializes new elements, doesn't lock
export function enableVolumeLock(vol: number, muted: boolean): void {
	targetVolume = vol;
	targetMuted = muted;

	// Apply to current uninitialized elements
	const videos = document.getElementsByTagName('video');
	const audios = document.getElementsByTagName('audio');

	for (let i = 0; i < videos.length; i++) {
		const v = videos[i];
		if (v) applyVolumeToElement(v, vol, muted);
	}
	for (let i = 0; i < audios.length; i++) {
		const a = audios[i];
		if (a) applyVolumeToElement(a, vol, muted);
	}

	startMonitoring();
}

// eff: release volume monitoring
export function releaseVolumeLock(): void {
	stopMonitoring();
}

// inv: monitoring state
let isMonitoring = false;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

// eff: start monitoring for new media elements
function startMonitoring(): void {
	if (isMonitoring) return;
	isMonitoring = true;

	// eff: periodically check for new media elements and initialize them
	monitorInterval = setInterval(() => {
		const videos = document.getElementsByTagName('video');
		const audios = document.getElementsByTagName('audio');

		for (let i = 0; i < videos.length; i++) {
			const v = videos[i];
			if (v && !initializedElements.has(v)) {
				applyVolumeToElement(v, targetVolume, targetMuted);
			}
		}
		for (let i = 0; i < audios.length; i++) {
			const a = audios[i];
			if (a && !initializedElements.has(a)) {
				applyVolumeToElement(a, targetVolume, targetMuted);
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
	if (!isMonitoring) {
		startMonitoring();
	}
}

// eff: hijack native volume setters to detect user changes (NOT to enforce)
function hijackVolumeSetters(): void {
	const originalVolumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
	const originalMutedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');

	if (!originalVolumeDescriptor || !originalMutedDescriptor) return;

	// eff: hijack volume setter to detect user changes
	Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
		get() {
			return originalVolumeDescriptor.get?.call(this) ?? 1;
		},
		set(value: number) {
			const oldVol = originalVolumeDescriptor.get?.call(this) ?? 1;

			// Always apply the value (don't block user)
			originalVolumeDescriptor.set?.call(this, value);

			// Detect if this is a user-initiated change (significant difference)
			if (Math.abs(oldVol - value) > 0.001) {
				// Mark element as user-controlled
				initializedElements.add(this);

				// Notify plugin of user change
				if (onNativeVolumeChange) {
					onNativeVolumeChange(value, this.muted);
				}
			}
		},
		configurable: true
	});

	// eff: hijack muted setter to detect user changes
	Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
		get() {
			return originalMutedDescriptor.get?.call(this) ?? false;
		},
		set(value: boolean) {
			const oldMuted = originalMutedDescriptor.get?.call(this) ?? false;

			// Always apply the value (don't block user)
			originalMutedDescriptor.set?.call(this, value);

			// Detect if this is a user-initiated change
			if (oldMuted !== value) {
				// Mark element as user-controlled
				initializedElements.add(this);

				// Notify plugin of user change
				if (onNativeVolumeChange) {
					onNativeVolumeChange(-1, value);
				}
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
