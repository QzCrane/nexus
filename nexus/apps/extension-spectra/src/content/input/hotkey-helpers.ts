// goal: helper utilities for translating content-script hotkey interactions
import type { HotkeyAction, HotkeyParams, AudioConfig } from '@nexus/contracts';
import { listMarkers } from '../video/time-marker';
import { showToast } from '../ui/toast';
import { getPrimaryVideo } from '../utils/media-utils';
import { sendSpectraRequest } from '../../shared/spectra-client';

let getConfigFn: (() => AudioConfig) | null = null;
let updateConfigFn: ((changes: Partial<AudioConfig>, options?: { showOSD?: boolean; unMute?: boolean }) => void) | null = null;
let toggleCaptureModeFn: (() => void) | null = null;

export function setConfigGetter(getter: () => AudioConfig): void { getConfigFn = getter; }
export function setConfigUpdater(updater: (changes: Partial<AudioConfig>, options?: { showOSD?: boolean; unMute?: boolean }) => void): void { updateConfigFn = updater; }
export function setCaptureModeToggler(toggle: () => void): () => void {
	toggleCaptureModeFn = toggle;
	return () => {
		if (toggleCaptureModeFn === toggle) toggleCaptureModeFn = null;
	};
}

function getConfig(): AudioConfig {
	return getConfigFn ? getConfigFn() : { volume: 100, muted: false } as AudioConfig;
}

export function sendVolumeAction(action: HotkeyAction, params?: HotkeyParams): void {
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : 10;
	const c = getConfig();
	let ch: Partial<AudioConfig> = {};
	let shouldUnMute = false;

	switch (action) {
		case 'volume_up':
			ch = { volume: Math.min(800, (c.volume ?? 100) + step) };
			shouldUnMute = true;
			break;
		case 'volume_down':
			ch = { volume: Math.max(0, (c.volume ?? 100) - step) };
			shouldUnMute = true;
			break;
		case 'volume_mute': ch = { muted: !c.muted }; break;
		case 'volume_set':
			if (Number.isFinite(params?.volume)) ch = { volume: Math.max(0, Math.min(800, params!.volume!)) };
			shouldUnMute = true;
			break;
	}

	if (updateConfigFn) updateConfigFn(ch, { showOSD: true, unMute: shouldUnMute });
}

// eff: handles speed adjustment hotkeys through unified config flow
export function sendSpeedAction(action: HotkeyAction, params?: HotkeyParams): void {
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : 0.1;
	const c = getConfig();
	let newSpeed: number = c.speed ?? 1;

	switch (action) {
		case 'speed_up': newSpeed = Math.min(16, newSpeed + step); break;
		case 'speed_down': newSpeed = Math.max(0.1, newSpeed - step); break;
		case 'speed_reset': newSpeed = 1; break;
		case 'speed_set': if (Number.isFinite(params?.speed)) newSpeed = Math.max(0.1, Math.min(16, params!.speed!)); break;
	}

	// note: round to 2 decimal places to avoid floating point errors
	newSpeed = Math.round(newSpeed * 100) / 100;
	if (updateConfigFn) updateConfigFn({ speed: newSpeed }, { showOSD: true });
}

export function sendAudioReset(): void {
	updateConfigFn?.(
		{ volume: 100, muted: false, eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: false, compressor: false, mono: false, pan: 0, delay: 0 },
		{ showOSD: true }
	);
}

export function sendAudioAdjustment(action: HotkeyAction, params?: HotkeyParams): void {
	const config = getConfig();
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : undefined;
	let changes: Partial<AudioConfig> | null = null;

	switch (action) {
		case 'gain_up':
			changes = { volume: Math.min(800, config.volume + (step ?? 10)), muted: false };
			break;
		case 'gain_down':
			changes = { volume: Math.max(0, config.volume - (step ?? 10)), muted: false };
			break;
		case 'delay_up':
			changes = { delay: Math.min(500, (config.delay ?? 0) + (step ?? 10)) };
			break;
		case 'delay_down':
			changes = { delay: Math.max(0, (config.delay ?? 0) - (step ?? 10)) };
			break;
		case 'delay_reset':
			changes = { delay: 0 };
			break;
		case 'pan_left':
			changes = { pan: Math.max(-1, (config.pan ?? 0) - Math.min(1, step ?? 0.1)) };
			break;
		case 'pan_right':
			changes = { pan: Math.min(1, (config.pan ?? 0) + Math.min(1, step ?? 0.1)) };
			break;
		case 'pan_reset':
			changes = { pan: 0 };
			break;
		case 'mono_toggle':
			changes = { mono: !config.mono };
			break;
	}

	if (changes) updateConfigFn?.(changes, { showOSD: true, unMute: action === 'gain_up' || action === 'gain_down' });
}

export function sendCaptureToggle(): void {
	// Capture is a document-owned mode intent. The policy executor performs the
	// transparent handoff and advances generation before its manager contacts
	// background/offscreen; hotkeys must never bypass that state machine.
	toggleCaptureModeFn?.();
}

export function jumpMarker(fwd: boolean): void {
	const m = listMarkers();
	if (!m.length) return;
	const v = getPrimaryVideo();
	if (!v) return;
	const t = v.currentTime;

	if (fwd) {
		const next = m.find(x => x && x.time > t + 0.5);
		if (next) { v.currentTime = next.time; showToast(`Jump to ${next.label}`); }
	} else {
		for (let i = m.length - 1; i >= 0; i--) {
			const mk = m[i];
			if (mk && mk.time < t - 0.5) { v.currentTime = mk.time; showToast(`Jump to ${mk.label}`); return; }
		}
	}
}

export function toggleLoop(): void {
	const v = getPrimaryVideo();
	if (v) {
		v.loop = !v.loop;
		showToast(v.loop ? 'Loop ON' : 'Loop OFF');
	}
}

export function sendTabAction(action: HotkeyAction): void {
	const type = action === 'tab_pin'
		? 'spectra.tab.pinned.toggle' as const
		: 'spectra.tab.muted.toggle' as const;
	void sendSpectraRequest(type, {}).catch(() => undefined);
}
