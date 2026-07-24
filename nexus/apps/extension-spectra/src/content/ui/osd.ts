// goal: transient visual feedback (On-Screen Display) for adjustments

import type { AudioConfig } from '@nexus/kernel';
import { resolveAudioVolume, type SpectraHotkeyActualFeedback } from '@nexus/contracts';
import type { ContentGlobalSettings } from '../core/settings-manager';
import { activateFeedbackSurface, createFeedbackSurface } from './feedback-surface';
import {
	scalarFeedbackAnimationDuration,
	scalarFeedbackMarkers,
	scalarFeedbackProgress,
	type ScalarFeedbackKind,
} from './scalar-feedback';

interface OSDState {
	host: HTMLElement | null;
	root: ShadowRoot | null;
	timer: ReturnType<typeof setTimeout> | null;
	animationFrame: number | null;
	displayedValue: number | null;
	shortcutTargetGesture: number | null;
	lastType: 'volume' | 'speed' | null;
}
const state: OSDState = {
	host: null,
	root: null,
	timer: null,
	animationFrame: null,
	displayedValue: null,
	shortcutTargetGesture: null,
	lastType: null,
};

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
	if (state.shortcutTargetGesture !== null) return;
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
	if (state.shortcutTargetGesture !== null) return;
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

// eff: projects every physical scalar repeat immediately while the acknowledged
// writer remains single-flight; native ACK feedback is suppressed until keyup
// so a slower value cannot visually rewind the held shortcut target.
export function showHotkeyTargetOSD(
	feedback: SpectraHotkeyActualFeedback,
	s: ContentGlobalSettings,
	gesture: number,
): void {
	if (!s.osdEnabled) return;
	state.shortcutTargetGesture = gesture;
	renderOSD(feedback.kind === 'volume'
		? {
			type: 'volume',
			value: feedback.value,
			muted: feedback.muted || feedback.value === 0,
			capture: feedback.capture,
		}
		: { type: 'speed', value: feedback.value }, s, {});
}

type OSDPayload =
	| { type: 'volume'; value: number; muted: boolean; capture: boolean }
	| { type: 'speed'; value: number };

function formatSpeed(speed: number): string {
	const rounded = Math.round(speed * 100) / 100;
	return Number.isInteger(rounded * 10)
		? rounded.toFixed(1)
		: rounded.toFixed(2).replace(/0$/u, '');
}

function cancelValueAnimation(): void {
	if (state.animationFrame !== null) cancelAnimationFrame(state.animationFrame);
	state.animationFrame = null;
}

function renderMarkers(root: ShadowRoot, type: ScalarFeedbackKind): void {
	const markerLayer = root.getElementById('marks');
	if (!markerLayer) return;
	const markers = scalarFeedbackMarkers(type).map((marker) => {
		const element = document.createElement('span');
		element.className = `mk ${marker.lane}`;
		element.dataset.label = marker.label;
		element.style.left = `${scalarFeedbackProgress(type, marker.value)}%`;
		return element;
	});
	markerLayer.replaceChildren(...markers);
}

function paintScalarValue(
	root: ShadowRoot,
	payload: OSDPayload,
	value: number,
	s: ContentGlobalSettings,
): void {
	const fill = root.getElementById('f');
	const text = root.getElementById('t');
	const icon = root.getElementById('i');
	if (!fill || !text || !icon) return;
	fill.style.width = `${scalarFeedbackProgress(payload.type, value)}%`;
	const target = payload.value;
	if (payload.type === 'speed') {
		text.textContent = `${formatSpeed(target)}×`;
		icon.textContent = target > 1 ? '⚡' : (target < 1 ? '🐢' : '⏱️');
		return;
	}
	text.textContent = payload.muted
		? s.osdMessages.muted
		: `${Number.isInteger(target) ? target : target.toFixed(1)}%`;
	icon.textContent = payload.muted ? '🔇' : (target > 100 ? '🚀' : '🔊');
}

function animateScalarValue(
	root: ShadowRoot,
	payload: OSDPayload,
	s: ContentGlobalSettings,
): void {
	cancelValueAnimation();
	const from = state.lastType === payload.type && state.displayedValue !== null
		? state.displayedValue
		: payload.value;
	const to = payload.value;
	if (payload.type === 'volume' && payload.muted
		|| from === to) {
		state.displayedValue = to;
		paintScalarValue(root, payload, to, s);
		return;
	}
	const duration = scalarFeedbackAnimationDuration(payload.type, from, to);
	let startedAt: number | null = null;
	const step = (now: number): void => {
		startedAt ??= now;
		const progress = Math.min(1, (now - startedAt) / duration);
		const value = from + (to - from) * progress;
		state.displayedValue = value;
		paintScalarValue(root, payload, value, s);
		if (progress < 1) {
			state.animationFrame = requestAnimationFrame(step);
		} else {
			state.animationFrame = null;
			state.displayedValue = to;
		}
	};
	state.animationFrame = requestAnimationFrame(step);
}

function concealOSD(): void {
	cancelValueAnimation();
	state.root?.getElementById('o')?.classList.remove('v');
	state.timer = null;
	state.displayedValue = null;
	state.lastType = null;
}

// A held gesture disappears on keyup but keeps its identity until its one
// in-flight ACK settles. During that boundary, late actual feedback stays
// suppressed and cannot resurrect visual motion after release.
export function suspendHotkeyTargetOSD(gesture: number): void {
	if (state.shortcutTargetGesture !== gesture) return;
	if (state.timer) clearTimeout(state.timer);
	concealOSD();
}

export function releaseHotkeyTargetOSD(gesture: number): void {
	if (state.shortcutTargetGesture === gesture) state.shortcutTargetGesture = null;
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
		css.textContent = `.o{background:rgba(20,20,30,0.85);backdrop-filter:blur(8px);padding:12px 20px;border-radius:30px;color:#fff;display:grid;gap:4px;font-family:system-ui;transition:0.2s;opacity:0;transform:translateY(-10px)}.v{opacity:1;transform:translateY(0)}.r{display:flex;align-items:center;gap:12px}.g{width:160px;height:26px;position:relative;flex:none}.b{position:absolute;left:0;right:0;top:10px;height:6px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden}.f{height:100%;width:0%;background:#3b82f6}.c .f{background:#8b5cf6}.m .f{background:#9ca3af}.marks{position:absolute;inset:0;pointer-events:none}.mk{position:absolute;top:9px;width:1px;height:8px;background:rgba(255,255,255,0.72);transform:translateX(-.5px);z-index:5}.mk::after{content:attr(data-label);position:absolute;left:50%;transform:translateX(-50%);font-size:8px;line-height:9px;font-weight:600;white-space:nowrap;color:rgba(255,255,255,0.76)}.mk.upper::after{bottom:9px}.mk.lower::after{top:9px}.t{font-weight:600;font-size:14px;min-width:58px;text-align:right;font-variant-numeric:tabular-nums}.s .f{background:#10b981}.meta{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:11px;opacity:.78}.meta[hidden]{display:none}`;

		const o = document.createElement('div'); o.className = 'o'; o.id = 'o';
		const r = document.createElement('div'); r.className = 'r';
		const i = document.createElement('span'); i.id = 'i';
		const g = document.createElement('div'); g.className = 'g';
		const b = document.createElement('div'); b.className = 'b';
		const f = document.createElement('div'); f.className = 'f'; f.id = 'f';
		const marks = document.createElement('div'); marks.className = 'marks'; marks.id = 'marks';
		const t = document.createElement('span'); t.className = 't'; t.id = 't';
		const meta = document.createElement('div'); meta.className = 'meta'; meta.id = 'meta'; meta.hidden = true;

		b.append(f);
		g.append(b, marks);
		r.append(i, g, t);
		o.append(r, meta);
		ws.append(css, o);
		state.host = h;
		state.root = ws;
	}
	activateFeedbackSurface(state.host);

	const o = state.root.getElementById('o');
	const meta = state.root.getElementById('meta');
	if (!o || !meta) return;

	o.classList.add('v');
	o.classList.toggle('c', payload.type === 'volume' && payload.capture);
	o.classList.toggle('s', payload.type === 'speed');
	o.classList.toggle('m', payload.type === 'volume' && payload.muted);
	const alternate = options.variant === 'alternate-target';
	meta.toggleAttribute('hidden', !alternate);
	meta.textContent = alternate
		? `↗ ${options.targetTitle || options.targetHostname || ''}${options.targetTitle && options.targetHostname ? ` · ${options.targetHostname}` : ''}`
		: '';

	if (state.lastType !== payload.type) renderMarkers(state.root, payload.type);
	animateScalarValue(state.root, payload, s);
	state.lastType = payload.type;
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(concealOSD, OSD_HIDE_DELAY_MS);
}

// eff: removes the real value OSD immediately when a held shortcut is released.
export function hideOSD(preserveShortcutTarget = false): void {
	if (state.timer) clearTimeout(state.timer);
	concealOSD();
	if (!preserveShortcutTarget) state.shortcutTargetGesture = null;
}
