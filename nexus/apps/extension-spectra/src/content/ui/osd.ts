// goal: transient visual feedback (On-Screen Display) for adjustments

import type { AudioConfig } from '@nexus/kernel';
import { resolveAudioVolume, type SpectraHotkeyActualFeedback } from '@nexus/contracts';
import type { ContentGlobalSettings } from '../core/settings-manager';
import { activateFeedbackSurface, createFeedbackSurface } from './feedback-surface';

interface OSDState {
	host: HTMLElement | null;
	root: ShadowRoot | null;
	timer: ReturnType<typeof setTimeout> | null;
	lastType: 'volume' | 'speed' | null;
}
const state: OSDState = { host: null, root: null, timer: null, lastType: null };

export interface OSDOptions {
	variant?: 'alternate-target';
	targetTitle?: string;
	targetHostname?: string;
}

const OSD_HIDE_DELAY_MS = 2_000;

// eff: shows volume OSD with current config state
export function showOSD(
	c: AudioConfig,
	cap: boolean,
	s: ContentGlobalSettings,
	pop: boolean,
	options: OSDOptions = {},
): void {
	if (pop || !s.osdEnabled || !c.enabled) return;
	const volume = resolveAudioVolume(c);
	renderOSD({
		type: 'volume',
		value: volume.effectiveVolume,
		muted: c.muted || volume.effectiveVolume === 0,
		capture: cap,
	}, s, options);
}

// eff: shows speed OSD with current speed value
export function showSpeedOSD(
	speed: number,
	s: ContentGlobalSettings,
	pop: boolean,
	options: OSDOptions = {},
): void {
	if (pop || !s.osdEnabled) return;
	renderOSD({ type: 'speed', value: speed }, s, options);
}

// eff: renders an acknowledged value from a different shortcut-target tab with
// the standard OSD chrome; the only visual difference is the extra target row.
export function showHotkeyActualOSD(
	feedback: SpectraHotkeyActualFeedback,
	s: ContentGlobalSettings,
	options: OSDOptions = {},
): void {
	if (!s.osdEnabled) return;
	renderOSD(feedback.kind === 'volume'
		? {
			type: 'volume',
			value: feedback.value,
			muted: feedback.muted || feedback.value === 0,
			capture: feedback.capture,
		}
		: { type: 'speed', value: feedback.value }, s, options);
}

type OSDPayload =
	| { type: 'volume'; value: number; muted: boolean; capture: boolean }
	| { type: 'speed'; value: number };

function speedProgress(speed: number): number {
	const normalized = Math.max(0.1, Math.min(16, speed));
	return normalized <= 1
		? Math.log10(normalized / 0.1) * 50
		: 50 + (Math.log(normalized) / Math.log(16)) * 50;
}

function formatSpeed(speed: number): string {
	const rounded = Math.round(speed * 100) / 100;
	return Number.isInteger(rounded * 10)
		? rounded.toFixed(1)
		: rounded.toFixed(2).replace(/0$/u, '');
}

// eff: core OSD rendering logic, handles both volume and speed display modes
function renderOSD(payload: OSDPayload, s: ContentGlobalSettings, options: OSDOptions): void {
	if (!state.host?.isConnected || !state.root) {
		const surface = createFeedbackSurface(
			'spectra-osd-host',
			'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:2147483647',
		);
		const h = surface.host;
		const ws = surface.root;
		const css = document.createElement('style');
		css.textContent = `.o{background:rgba(20,20,30,0.85);backdrop-filter:blur(8px);padding:12px 20px;border-radius:30px;color:#fff;display:grid;gap:4px;font-family:system-ui;transition:0.2s;opacity:0;transform:translateY(-10px)}.v{opacity:1;transform:translateY(0)}.r{display:flex;align-items:center;gap:12px}.b{width:120px;height:6px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden;position:relative}.f{height:100%;width:0%;transition:width 0.05s linear;background:#3b82f6}.c .f{background:#8b5cf6}.m .f{background:#9ca3af}.mr{position:absolute;left:12.5%;top:0;bottom:0;width:2px;background:rgba(255,255,255,0.6);z-index:5}.s .mr{left:50%}.t{font-weight:600;font-size:14px;min-width:50px;text-align:right}.s .f{background:#10b981}.meta{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:11px;opacity:.78}.meta[hidden]{display:none}`;

		const o = document.createElement('div'); o.className = 'o'; o.id = 'o';
		const r = document.createElement('div'); r.className = 'r';
		const i = document.createElement('span'); i.id = 'i';
		const b = document.createElement('div'); b.className = 'b';
		const m = document.createElement('div'); m.className = 'mr';
		const f = document.createElement('div'); f.className = 'f'; f.id = 'f';
		const t = document.createElement('span'); t.className = 't'; t.id = 't';
		const meta = document.createElement('div'); meta.className = 'meta'; meta.id = 'meta'; meta.hidden = true;

		b.append(m, f);
		r.append(i, b, t);
		o.append(r, meta);
		ws.append(css, o);
		state.host = h;
		state.root = ws;
	}
	activateFeedbackSurface(state.host);

	const o = state.root.getElementById('o');
	const f = state.root.getElementById('f');
	const t = state.root.getElementById('t');
	const i = state.root.getElementById('i');
	const meta = state.root.getElementById('meta');
	if (!o || !f || !t || !i || !meta) return;

	o.classList.add('v');
	o.classList.toggle('c', payload.type === 'volume' && payload.capture);
	o.classList.toggle('s', payload.type === 'speed');
	const alternate = options.variant === 'alternate-target';
	meta.toggleAttribute('hidden', !alternate);
	meta.textContent = alternate
		? `↗ ${options.targetTitle || options.targetHostname || ''}${options.targetTitle && options.targetHostname ? ` · ${options.targetHostname}` : ''}`
		: '';

	if (payload.type === 'speed') {
		// speed display mode
		const speed = payload.value;
		o.classList.remove('m');
		// Give the common 0.1x-1x and 1x-16x ranges equal visual space. The
		// center marker is the semantic 1x baseline rather than a linear 16x cap.
		f.style.width = `${speedProgress(speed)}%`;
		t.textContent = `${formatSpeed(speed)}×`;
		i.textContent = speed > 1 ? '⚡' : (speed < 1 ? '🐢' : '⏱️');
	} else {
		// volume display mode
		const volume = payload.value;
		const muted = payload.muted;
		o.classList.toggle('m', muted);
		f.style.width = `${Math.max(0, Math.min(100, volume / 8))}%`;
		t.textContent = muted
			? s.osdMessages.muted
			: `${Number.isInteger(volume) ? volume : volume.toFixed(1)}%`;
		i.textContent = muted ? '🔇' : (volume > 100 ? '🚀' : '🔊');
	}

	state.lastType = payload.type;
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => o.classList.remove('v'), OSD_HIDE_DELAY_MS);
}

// eff: removes the real value OSD immediately when a held shortcut is released.
export function hideOSD(): void {
	if (state.timer) {
		clearTimeout(state.timer);
		state.timer = null;
	}
	state.root?.getElementById('o')?.classList.remove('v');
}
