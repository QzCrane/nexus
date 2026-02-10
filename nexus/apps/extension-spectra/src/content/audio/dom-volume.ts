// goal: manages DOM-based volume control with proper bidirectional sync
// role: detects user changes and syncs to plugin; applies plugin changes to page
// theory: uses source tracking to prevent sync loops

import { createLogger } from '../../shared/logger';

const log = createLogger('DOMVolume');

// inv: current plugin config state
let pluginVolume = 1; // 0-1 range
let pluginMuted = false;

// inv: flag to prevent callback loops when plugin sets values
let isApplyingPluginChange = false;

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

// eff: register callback for native volume changes (page UI → plugin)
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

// eff: apply volume from plugin to all media elements
// note: this is called when plugin changes volume, should not trigger callbacks
export function setDomVolume(vol: number, muted: boolean): void {
	// Convert 0-100 to 0-1
	const normalizedVol = vol / 100;

	// Update plugin state
	pluginVolume = normalizedVol;
	pluginMuted = muted;

	// Set flag to prevent callback loops
	isApplyingPluginChange = true;

	const videos = document.getElementsByTagName('video');
	const audios = document.getElementsByTagName('audio');

	for (let i = 0; i < videos.length; i++) {
		const v = videos[i];
		if (!v) continue;
		if (Math.abs(v.volume - normalizedVol) > 0.001) v.volume = normalizedVol;
		if (v.muted !== muted) v.muted = muted;
	}
	for (let i = 0; i < audios.length; i++) {
		const a = audios[i];
		if (!a) continue;
		if (Math.abs(a.volume - normalizedVol) > 0.001) a.volume = normalizedVol;
		if (a.muted !== muted) a.muted = muted;
	}

	// Clear flag after a tick to allow any pending setters to complete
	setTimeout(() => { isApplyingPluginChange = false; }, 0);
}

// eff: enable volume monitoring for new media elements
export function enableVolumeLock(vol: number, muted: boolean): void {
	// Apply immediately to existing elements
	setDomVolume(vol, muted);
	// Start monitoring for new elements
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

	monitorInterval = setInterval(() => {
		const videos = document.getElementsByTagName('video');
		const audios = document.getElementsByTagName('audio');

		let hasNewElement = false;

		for (let i = 0; i < videos.length; i++) {
			const v = videos[i];
			if (!v) continue;
			// Check if element needs initialization (different from plugin state)
			if (Math.abs(v.volume - pluginVolume) > 0.001 || v.muted !== pluginMuted) {
				hasNewElement = true;
				isApplyingPluginChange = true;
				if (Math.abs(v.volume - pluginVolume) > 0.001) v.volume = pluginVolume;
				if (v.muted !== pluginMuted) v.muted = pluginMuted;
			}
		}
		for (let i = 0; i < audios.length; i++) {
			const a = audios[i];
			if (!a) continue;
			if (Math.abs(a.volume - pluginVolume) > 0.001 || a.muted !== pluginMuted) {
				hasNewElement = true;
				isApplyingPluginChange = true;
				if (Math.abs(a.volume - pluginVolume) > 0.001) a.volume = pluginVolume;
				if (a.muted !== pluginMuted) a.muted = pluginMuted;
			}
		}

		if (hasNewElement) {
			setTimeout(() => { isApplyingPluginChange = false; }, 0);
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

// eff: hijack native volume setters to detect user changes
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
			const oldVol = originalVolumeDescriptor.get?.call(this) ?? 1;

			// Always apply the value
			originalVolumeDescriptor.set?.call(this, value);

			// Skip callback if this is a plugin-initiated change
			if (isApplyingPluginChange) return;

			// Detect user-initiated change
			if (Math.abs(oldVol - value) > 0.001) {
				log.debug(`[Native] Volume changed: ${oldVol} → ${value}`);
				if (onNativeVolumeChange) {
					onNativeVolumeChange(value, this.muted);
				}
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
			const oldMuted = originalMutedDescriptor.get?.call(this) ?? false;

			// Always apply the value
			originalMutedDescriptor.set?.call(this, value);

			// Skip callback if this is a plugin-initiated change
			if (isApplyingPluginChange) return;

			// Detect user-initiated change
			if (oldMuted !== value) {
				log.debug(`[Native] Mute changed: ${oldMuted} → ${value}`);
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
