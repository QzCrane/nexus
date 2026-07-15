// goal: event-driven DOM media ownership with reversible per-element configuration

import { createLogger } from '../../shared/logger';
import {
	getElementState,
	clearSettingByPlugin,
	holdSettingByPlugin,
	restoreElementBaselines,
	restoreVolumeBaseline,
	setupVolumeMonitor,
	type MonitorContext,
} from './volume-observer';

const log = createLogger('DOMVolume');

let targetVolume = 1;
let targetMuted = false;
let syncEnabled = true;
let volumeLockActive = false;
let userInteracted = false;
let onNativeVolumeChange: ((volume: number, muted: boolean) => void) | null = null;
let onNativeSpeedChange: ((speed: number) => void) | null = null;

const monitorDisposers = new Map<HTMLMediaElement, () => void>();

export const markUserInteracted = () => { userInteracted = true; };
export const hasUserInteracted = () => userInteracted;
export const setNativeVolumeCallback = (callback: (volume: number, muted: boolean) => void) => {
	onNativeVolumeChange = callback;
};
export const setNativeSpeedCallback = (callback: (speed: number) => void) => {
	onNativeSpeedChange = callback;
};

function monitorContext(onMediaEvent?: MonitorContext['onMediaEvent']): MonitorContext {
	return {
		getUserInteracted: () => userInteracted,
		isSyncEnabled: () => syncEnabled && volumeLockActive,
		getTargetVolume: () => targetVolume,
		getTargetMuted: () => targetMuted,
		onNativeVolumeChange: (volume, muted) => onNativeVolumeChange?.(volume, muted),
		onNativeSpeedChange: (speed) => onNativeSpeedChange?.(speed),
		onMediaEvent,
	};
}

function markPluginWrite(media: HTMLMediaElement): void {
	holdSettingByPlugin(media);
}

function clearPluginWrite(media: HTMLMediaElement): void {
	clearSettingByPlugin(media);
}

function applyTargetToMedia(media: HTMLMediaElement): boolean {
	if (!volumeLockActive) return false;
	const state = getElementState(media);
	if (Math.abs(media.volume - targetVolume) < 0.005 && media.muted === targetMuted) return false;
	if (!state.ownedBySpectra) {
		state.baselineVolume = media.volume;
		state.baselineMuted = media.muted;
		state.ownedBySpectra = true;
	}
	markPluginWrite(media);
	try {
		media.volume = targetVolume;
		media.muted = targetMuted;
		state.volume = targetVolume;
		state.muted = targetMuted;
		return true;
	} catch {
		return false;
	}
}

// eff: registers exactly one monitor for a media element and applies the current active target
export function registerDomMedia(
	media: HTMLMediaElement,
	onMediaEvent?: MonitorContext['onMediaEvent'],
): () => void {
	if (monitorDisposers.has(media)) return () => undefined;
	const disposeMonitor = setupVolumeMonitor(media, monitorContext(onMediaEvent));
	monitorDisposers.set(media, disposeMonitor);
	applyTargetToMedia(media);
	return () => unregisterDomMedia(media);
}

// eff: detaches listeners/rAF and returns a detached element to its page-owned baseline
export function unregisterDomMedia(media: HTMLMediaElement): void {
	const disposeMonitor = monitorDisposers.get(media);
	if (!disposeMonitor) return;
	monitorDisposers.delete(media);
	disposeMonitor();
	clearPluginWrite(media);
	try {
		restoreElementBaselines(media);
	} finally {
		clearSettingByPlugin(media);
	}
}

export function refreshDomMedia(media: HTMLMediaElement): void {
	if (!monitorDisposers.has(media)) registerDomMedia(media);
	applyTargetToMedia(media);
}

export function setDomVolume(volume: number, muted: boolean): void {
	targetVolume = volume > 1 ? volume / 100 : volume;
	targetMuted = muted;
	volumeLockActive = true;

	let applied = 0;
	for (const media of monitorDisposers.keys()) {
		if (applyTargetToMedia(media)) applied += 1;
	}
	if (applied > 0) log.debug(`[DOM] Vol Applied: ${(targetVolume * 100) | 0}% -> ${applied}`);
}

export function releaseVolumeLock(): void {
	syncEnabled = false;
	volumeLockActive = false;
	targetVolume = 1;
	targetMuted = false;

	for (const media of monitorDisposers.keys()) {
		const state = getElementState(media);
		if (!state.ownedBySpectra) continue;
		markPluginWrite(media);
		try {
			restoreVolumeBaseline(media);
		} catch {
			// A page may replace a media element's property descriptors during teardown.
		}
	}
}

export function enableVolumeLock(volume: number, muted: boolean): void {
	syncEnabled = true;
	setDomVolume(volume, muted);
}

export const enableDirectTake = () => { syncEnabled = false; };
