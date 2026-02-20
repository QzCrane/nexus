import { createLogger } from '../../shared/logger';

const log = createLogger('VolumeObserver');

export type ElementState = {
	volume: number; muted: boolean; speed: number; settingByPlugin: boolean;
	hasReceivedUserEvent: boolean;
};

// perf: WeakMap for O(1) state, WeakSet for O(1) existence
const monitoredElements = new WeakSet<HTMLMediaElement>();
const elementStates = new WeakMap<HTMLMediaElement, ElementState>();

// perf: event throttling - batch rapid events
const throttleMap = new WeakMap<HTMLMediaElement, { volume: number; speed: number; rafId: number | null }>();
const THROTTLE_MS = 16; // ~1 frame

const getDefault = (m: HTMLMediaElement): ElementState => ({
	volume: m.volume, muted: m.muted, speed: m.playbackRate, settingByPlugin: false, hasReceivedUserEvent: false
});

export function getElementState(media: HTMLMediaElement): ElementState {
	let s = elementStates.get(media);
	if (!s) elementStates.set(media, s = getDefault(media));
	return s;
}

export function setElementState(media: HTMLMediaElement, p: Partial<ElementState>): void {
	const s = getElementState(media);
	if (p.volume !== undefined) s.volume = p.volume;
	if (p.muted !== undefined) s.muted = p.muted;
	if (p.speed !== undefined) s.speed = p.speed;
	if (p.settingByPlugin !== undefined) s.settingByPlugin = p.settingByPlugin;
	if (p.hasReceivedUserEvent !== undefined) s.hasReceivedUserEvent = p.hasReceivedUserEvent;
}

export const isMonitored = (media: HTMLMediaElement) => monitoredElements.has(media);
export const markMonitored = (media: HTMLMediaElement) => monitoredElements.add(media);

export interface MonitorContext {
	getUserInteracted: () => boolean;
	isSyncEnabled: () => boolean;
	getTargetVolume: () => number;
	getTargetMuted: () => boolean;
	onNativeVolumeChange: (volume: number, muted: boolean) => void;
	onNativeSpeedChange?: (speed: number) => void;
}

// perf: inline diff calculation
const fastAbs = (x: number): number => x > 0 ? x : -x;

export function setupVolumeMonitor(media: HTMLMediaElement, ctx: MonitorContext): void {
	getElementState(media); // Ensure init

	// perf: throttled handlers
	const getThrottle = () => {
		let t = throttleMap.get(media);
		if (!t) {
			t = { volume: media.volume, speed: media.playbackRate, rafId: null };
			throttleMap.set(media, t);
		}
		return t;
	};

	// eff: reset state when media loads new content (prevents stale speed from triggering false sync)
	media.addEventListener('emptied', () => {
		const s = elementStates.get(media)!;
		// inv: update stored speed to match browser default (1.0) to prevent ratechange feedback
		s.speed = 1;
		// inv: also reset volume state to match current element state
		s.volume = media.volume;
		s.muted = media.muted;
		// perf: reset throttle state
		const t = throttleMap.get(media);
		if (t) {
			t.volume = media.volume;
			t.speed = 1;
		}
	});

	media.addEventListener('volumechange', (e) => {
		const s = elementStates.get(media)!;
		if (s.settingByPlugin) return;

		// perf: throttle rapid events
		const t = getThrottle();
		if (t.rafId !== null) return; // Already scheduled
		
		t.rafId = requestAnimationFrame(() => {
			t.rafId = null;
			
			// rule: Ignore events unless untrusted or user interacted
			if (!ctx.getUserInteracted() && !e.isTrusted) return;

			const nv = media.volume, nm = media.muted;
			const diff = fastAbs(nv - ctx.getTargetVolume());
			const diffMute = nm !== ctx.getTargetMuted();

			// Advanced Mode (Sync native range only)
			if (!ctx.isSyncEnabled()) {
				// Implicit unmute
				if (s.muted && !nm && nv > 0) {
					log.debug(`[DOM] Adv Unmute`);
					ctx.onNativeVolumeChange(-1, nm);
				} else if (fastAbs(nv - s.volume) > 0.005) {
					log.debug(`[DOM] Adv Vol: ${(nv * 100) | 0}%`);
					ctx.onNativeVolumeChange(nv, nm);
				}
				s.volume = nv; s.muted = nm;
				return;
			}

			// Sync Mode
			const allowMute = ctx.getUserInteracted() || s.hasReceivedUserEvent;
			if (diff > 0.005) {
				log.debug(`[DOM] Vol: ${(nv * 100) | 0}%`);
				ctx.onNativeVolumeChange(nv, allowMute ? nm : ctx.getTargetMuted());
				s.volume = nv; s.muted = nm; s.hasReceivedUserEvent = true;
			} else if (diffMute && allowMute) {
				log.debug(`[DOM] Mute: ${nm}`);
				ctx.onNativeVolumeChange(-1, nm);
				s.volume = nv; s.muted = nm; s.hasReceivedUserEvent = true;
			} else {
				s.volume = nv; s.muted = nm;
			}
		});
	});

	media.addEventListener('ratechange', (e) => {
		const s = elementStates.get(media)!;
		if (s.settingByPlugin) return;

		// perf: throttle rapid events
		const t = getThrottle();
		if (t.rafId !== null) {
			// Update pending speed but don't schedule another frame
			t.speed = media.playbackRate;
			return;
		}
		
		t.rafId = requestAnimationFrame(() => {
			t.rafId = null;
			
			// note: speed changes are almost always user or script initiated (no browser default like mute)
			const ns = media.playbackRate;
			if (fastAbs(ns - s.speed) > 0.005) {
				log.debug(`[DOM] Rate: ${ns}`);
				ctx.onNativeSpeedChange?.(ns);
				s.speed = ns;
			}
		});
	});
}
