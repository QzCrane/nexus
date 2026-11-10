// goal: transient visual feedback (On-Screen Display) for adjustments

import { UI_COLORS } from '../../shared/ui-colors';
import type {
	SpectraHotkeyActualFeedback,
	VolumeTone,
	SpectraHotkeyPresentation,
	SpectraHotkeyPresentationToken,
} from '@nexus/contracts';
import { audioVolumeStateToVolumeTone, stepEffectiveVolume } from '@nexus/contracts';
import type { ContentGlobalSettings } from '../core/settings-manager';
import { activateFeedbackSurface, createFeedbackSurface } from './feedback-surface';
import {
	scalarFeedbackAnimationDuration,
	clampScalarFeedbackValue,
	scalarFeedbackMaxFrameDelta,
	scalarFeedbackMarkers,
	scalarFeedbackProgress,
	type ScalarFeedbackKind,
} from './scalar-feedback';

export type OSDPayload =
	| { type: 'volume'; value: number; tone: VolumeTone }
	| { type: 'speed'; value: number };
type VolumeOSDPayload = Extract<OSDPayload, { type: 'volume' }>;

/**
 * The palette decision for one predicted volume value.
 *
 * The OSD does not own it: a shortcut gesture must paint the same tone the
 * Popup slider and the Action badge paint for the same document at the same
 * moment, so the caller supplies the one shared decision (`resolveVolumeTone`
 * with a live-gesture prediction) and the OSD only renders its result.
 */
export type VolumeToneResolver = (volume: number) => VolumeTone;

type HotkeyOSDPhase = 'active' | 'frozen' | 'settled';

interface HotkeyOSDTransaction {
	gesture: string;
	phase: HotkeyOSDPhase;
	alternate: boolean;
	target: OSDPayload;
	tone: VolumeTone;
	settlement: {
		actual: OSDPayload;
		settings: ContentGlobalSettings;
		options: OSDOptions;
	} | null;
}

interface OSDState {
	host: HTMLElement | null;
	root: ShadowRoot | null;
	timer: ReturnType<typeof setTimeout> | null;
	animationFrame: number | null;
	displayedValue: number | null;
	presentation: OSDPayload | null;
	hotkey: HotkeyOSDTransaction | null;
	claimedGesture: string | null;
	lastTargetAt: number | null;
	lastType: 'volume' | 'speed' | null;
	pendingVolume: Extract<SpectraHotkeyPresentation, { phase: 'pending' }> | null;
	disposed: boolean;
}
const state: OSDState = {
	host: null,
	root: null,
	timer: null,
	animationFrame: null,
	displayedValue: null,
	presentation: null,
	hotkey: null,
	claimedGesture: null,
	lastTargetAt: null,
	lastType: null,
	pendingVolume: null,
	disposed: false,
};

export interface OSDOptions {
	variant?: 'alternate-target';
	targetTitle?: string;
	targetHostname?: string;
}

const OSD_HIDE_DELAY_MS = 2_000;

export function resolveHotkeyVolumeBaseline(
	visible: VolumeOSDPayload | null,
	baseline: VolumeOSDPayload | null,
	priorPhase?: HotkeyOSDPhase,
): VolumeOSDPayload | null {
	return priorPhase !== undefined && priorPhase !== 'settled'
		? visible ?? baseline
		: baseline ?? visible;
}

// A released gesture keeps its optimistic target only when no exact actual was
// observed. Gesture identity is part of the reducer so a late prior ACK cannot
// become the terminal presentation of a newer shortcut.
export function resolveHotkeyReleasePresentation(
	releaseGesture: string,
	ownerGesture: string,
	target: OSDPayload,
	settlement: OSDPayload | null,
): OSDPayload | null {
	if (releaseGesture !== ownerGesture) return null;
	return settlement ?? target;
}

// The OSD is the only owner of the transient shortcut target. Input listeners
// provide physical deltas and the latest local actual baseline; they never keep
// a second predicted value that can drift across ACKs or gestures.
export function advanceHotkeyTargetOSD(
	baseline: SpectraHotkeyActualFeedback,
	delta: number,
	s: ContentGlobalSettings,
	gesture: string,
	resolveTone?: VolumeToneResolver,
): void {
	if (state.disposed || !s.osdEnabled) return;
	state.claimedGesture = gesture;
	const priorHotkey = state.hotkey;
	const sameKind = priorHotkey?.target.type === baseline.kind;
	const previousTarget = sameKind ? priorHotkey.target.value : undefined;
	const step = Math.abs(delta);
	const base = previousTarget !== undefined
		&& (priorHotkey?.gesture === gesture && priorHotkey.phase === 'active'
			|| priorHotkey?.phase !== 'settled'
				&& Math.abs(previousTarget - baseline.value) <= step + 0.001)
		? previousTarget
		: baseline.value;
	// The prediction is the coordinator's own step rule, not local arithmetic:
	// a volume step near the native ceiling has to show the value that will
	// actually be written, or the pill settles onto a different number.
	const next = baseline.kind === 'volume'
		? stepEffectiveVolume(base, delta)
		: Math.round((base + delta) * 100) / 100;
	const value = clampScalarFeedbackValue(baseline.kind, next);
	const feedback = { ...baseline, value };
	const started = priorHotkey?.gesture !== gesture;
	const visibleVolume = state.presentation?.type === 'volume'
		? state.presentation
		: null;
	const baselineVolume = baseline.kind === 'volume'
		? feedbackPayload({ ...baseline, value: base }) as VolumeOSDPayload
		: null;
	const previous = resolveHotkeyVolumeBaseline(
		visibleVolume,
		baselineVolume,
		started ? priorHotkey?.phase : 'active',
	);
	const predictedTone = feedback.kind === 'volume' ? feedbackPayload(feedback) : null;
	const hotkey: HotkeyOSDTransaction = !started && priorHotkey
		? priorHotkey
		: {
			gesture,
			phase: 'active',
			alternate: false,
			target: feedbackPayload(feedback),
			// A continuing gesture keeps the tone the user already sees. A new one
			// starts from the acknowledged tone of the value it is leaving, and its
			// first target is predicted forward - predicting from step one is what
			// removes the "colour arrives with the acknowledgement" lag.
			tone: previous !== null && previous.value > 0
				? previous.tone
				: predictedTone?.type === 'volume' ? predictedTone.tone : 'native',
			settlement: null,
		};
	state.hotkey = hotkey;
	if (hotkey.phase !== 'active' || hotkey.alternate) return;
	if (feedback.kind === 'speed') {
		hotkey.target = { type: 'speed', value };
		renderOSD(hotkey.target, s, {});
		return;
	}
	const tone = value <= 0 ? 'muted' : resolveTone?.(value) ?? hotkey.tone;
	const target: VolumeOSDPayload = { type: 'volume', value, tone };
	hotkey.tone = tone;
	hotkey.target = target;
	renderOSD(target, s, {});
}

// A non-predictive actual-OSD action (mute/reset/set) still claims the current
// physical gesture before its ACK arrives. This lets it supersede an older
// visible transaction while rejecting a late ACK from that older gesture.
export function claimHotkeyActualOSDGesture(gesture: string): void {
	if (state.disposed) return;
	state.claimedGesture = gesture;
}

export function scalarHotkeyGestureSequence(gesture: string): number | null {
	const match = /^(?:default|site):([1-9]\d*)$/u.exec(gesture);
	if (!match) return null;
	const sequence = Number(match[1]);
	return Number.isSafeInteger(sequence) ? sequence : null;
}

export function admitsHotkeyActualOSDGesture(
	gesture: string,
	allowOwnerless = true,
): boolean {
	if (state.disposed) return false;
	// The lightweight bootstrap can accept a gesture immediately before the
	// full runtime is replaced or first loaded. An exact-document background
	// ACK may therefore be the new runtime's first observation of that gesture.
	// Admit that ownerless state, but never let an older ACK overwrite a
	// different locally claimed gesture.
	const owners = [state.claimedGesture, state.hotkey?.gesture]
		.filter((value): value is string => typeof value === 'string');
	if (owners.length === 0) return allowOwnerless;
	if (owners.includes(gesture)) return true;
	const candidateSequence = scalarHotkeyGestureSequence(gesture);
	const ownerSequences = owners
		.map(scalarHotkeyGestureSequence)
		.filter((value): value is number => value !== null);
	return candidateSequence !== null
		&& ownerSequences.length === owners.length
		&& candidateSequence > Math.max(...ownerSequences);
}

function feedbackPayload(feedback: SpectraHotkeyActualFeedback): OSDPayload {
	return feedback.kind === 'volume'
		? {
			type: 'volume',
			value: feedback.value,
			tone: audioVolumeStateToVolumeTone(feedback.volumeState),
		}
		: { type: 'speed', value: feedback.value };
}

function updateAcknowledgedTone(
	hotkey: HotkeyOSDTransaction,
	actual: VolumeOSDPayload,
): void {
	// A zero value hides processor tone but does not prove that the processor
	// changed. A positive ACK is complete: muted then means media mute.
	if (actual.value > 0) hotkey.tone = actual.tone;
}

export function stageHotkeyVolumePresentation(
	presentation: Extract<SpectraHotkeyPresentation, { phase: 'pending' }>,
	s: ContentGlobalSettings,
	options: OSDOptions,
	gesture?: string,
): void {
	if (state.disposed || !s.osdEnabled) return;
	const current = state.pendingVolume;
	if (current?.token.owner === presentation.token.owner && current.token.revision > presentation.token.revision) return;
	if (gesture && !admitsHotkeyActualOSDGesture(gesture, state.claimedGesture === null)) return;
	// A pending plan may refine an existing gesture, but never resurrect its
	// retired pill after key release or the existing hide timer.
	if (gesture && isGesturePresentationRetired(gesture)) return;
	if (gesture) state.claimedGesture = gesture;
	state.pendingVolume = presentation;
	if (gesture && state.hotkey?.gesture === gesture && state.hotkey.target.type === 'volume') {
		if (options.variant === 'alternate-target') {
			state.hotkey.alternate = true;
			state.hotkey.tone = presentation.tone;
			state.hotkey.target = { type: 'volume', value: presentation.volume, tone: presentation.tone };
			renderOSD(state.hotkey.target, s, options);
			return;
		}
		// The token still owns settlement, but its older value must not lend
		// its colour to a newer locally predicted target in the same gesture.
		if (state.hotkey.alternate || state.hotkey.target.value !== presentation.volume) return;
		state.hotkey.tone = presentation.tone;
		state.hotkey.target = { ...state.hotkey.target, tone: presentation.tone };
		if (state.root && state.presentation?.type === 'volume' && state.presentation.value === presentation.volume) {
			state.presentation = { ...state.presentation, tone: presentation.tone };
			paintOSDColor(state.root, state.presentation);
		}
		return;
	}
	renderOSD({ type: 'volume', value: presentation.volume, tone: presentation.tone }, s, options);
}

function isGesturePresentationRetired(gesture: string): boolean {
	return state.hotkey?.gesture === gesture && state.hotkey.phase === 'settled' && state.presentation === null;
}

export function settleHotkeyVolumePresentation(token: SpectraHotkeyPresentationToken): boolean {
	const pending = state.pendingVolume;
	if (!pending || pending.token.owner !== token.owner || pending.token.revision > token.revision) return false;
	state.pendingVolume = null;
	return true;
}

function paintOSDColor(root: ShadowRoot, payload: OSDPayload): void {
	const fill = root.getElementById('f');
	if (!fill) return;
	// Render one admitted value/tone pair. Pending work is not another colour
	// owner: it may describe a previous input while this payload is newer.
	const tone = payload.type === 'volume' ? payload.tone : 'native';
	fill.style.backgroundColor = payload.type === 'speed'
		? UI_COLORS.SUCCESS
		: tone === 'capture'
			? UI_COLORS.CAPTURE
			: tone === 'muted'
				? UI_COLORS.MUTED
				: UI_COLORS.NATIVE;
}

// eff: commits one gesture-bound aggregate ACK; a different target adds only
// the target row and then owns prediction for the rest of that gesture.
export function showHotkeyActualOSD(
	feedback: SpectraHotkeyActualFeedback,
	s: ContentGlobalSettings,
	options: OSDOptions = {},
	gesture?: string,
): void {
	if (state.disposed || !s.osdEnabled) return;
	const alternate = options.variant === 'alternate-target';
	let hotkey = state.hotkey;
	if (!gesture) {
		if (hotkey && hotkey.phase !== 'settled') return;
		renderOSD(feedbackPayload(feedback), s, options);
		return;
	}
	const actual = feedbackPayload(feedback);
	const claimedByNewGesture = state.claimedGesture === gesture
		&& hotkey?.gesture !== gesture;
	if (state.claimedGesture !== null
		&& state.claimedGesture !== gesture) return;
	if (!hotkey || claimedByNewGesture) {
		hotkey = {
			gesture,
			phase: 'active',
			alternate,
			target: actual,
			tone: actual.type === 'volume' ? actual.tone : 'native',
			settlement: null,
		};
		state.hotkey = hotkey;
		state.claimedGesture = gesture;
		renderOSD(actual, s, options);
		return;
	}
	if (hotkey.gesture !== gesture
		|| hotkey.alternate && !alternate) return;
	if (hotkey.phase === 'settled') {
		const targetMatches = hotkey.target.type === actual.type
			&& hotkey.target.value === actual.value
			&& (hotkey.target.type !== 'volume'
				|| actual.type === 'volume' && hotkey.target.tone === actual.tone);
		if (targetMatches) return;
		// Reconcile the finished gesture with its actual result without executing
		// another action. An active newer gesture is fenced above.
		if (actual.type === 'volume') updateAcknowledgedTone(hotkey, actual);
		hotkey.target = actual;
		// A retired pill keeps its place in history: this ACK only corrects the
		// state the next gesture starts from. Re-rendering here would resurrect a
		// presentation the user already watched disappear.
		if (state.presentation?.type !== actual.type) return;
		renderOSD(actual, s, options, false, true);
		return;
	}
	if (alternate) {
		hotkey.alternate = alternate;
		hotkey.target = actual;
		if (actual.type === 'volume') updateAcknowledgedTone(hotkey, actual);
		renderOSD(
			actual,
			s,
			options,
			hotkey.phase === 'active',
			hotkey.phase === 'active',
		);
		return;
	}
	// The final ACK can arrive before keyup retires unsent repeats. Retain it
	// throughout the gesture so release does not wait for a nonexistent later ACK.
	// Prediction remains visible until release; only the latest actual is kept.
	hotkey.settlement = { actual, settings: s, options };
	if (hotkey.phase === 'frozen') return;
	// A partial gesture ACK can settle 100 while the held key already predicts
	// 110. Keep the complete ACK for release, never splice its tone into 110.
	if (actual.type !== hotkey.target.type || actual.value !== hotkey.target.value) return;
	if (state.presentation?.type !== feedback.kind) {
		// The pill is already off screen. The acknowledgement still owns the
		// transaction (the next gesture starts from it), so record the tone and
		// leave the retired presentation alone.
		if (feedback.kind !== 'volume' || hotkey.target.type !== 'volume') return;
		updateAcknowledgedTone(hotkey, actual as VolumeOSDPayload);
		hotkey.target = { ...hotkey.target, tone: hotkey.tone };
		return;
	}
	if (feedback.kind !== 'volume' || hotkey.target.type !== 'volume') return;
	updateAcknowledgedTone(hotkey, actual as VolumeOSDPayload);
	const target = {
		...hotkey.target,
		tone: hotkey.target.value <= 0 ? 'muted' : hotkey.tone,
	} satisfies VolumeOSDPayload;
	hotkey.target = target;
	// ACKs correct only the acknowledged tone. They must not rewind
	// the transient target, cancel its fill interpolation, or restart its timer.
	state.presentation = target;
	if (state.root) paintOSDColor(state.root, target);
}

/**
 * Repaint the visible tone from a fresh palette decision.
 *
 * The acknowledgement of a gesture settles its *fields*; the processor it handed
 * the document to settles later, as a lifecycle of its own. Without this entry
 * point the pill kept the predicted colour for its whole display window while
 * the Popup and the badge had already followed the session, which is the exact
 * disagreement one tone decision is supposed to make impossible.
 */
export function repaintHotkeyVolumeTone(resolveTone: VolumeToneResolver): void {
	if (state.disposed || !state.root || !state.hotkey) return;
	// This resolver describes the foreground document. Another tab's feedback
	// can only be updated by that target's own staged/acknowledged projection.
	if (state.hotkey.alternate) return;
	if (state.pendingVolume) return;
	const hotkey = state.hotkey;
	// A live gesture owns its frame. An acknowledgement that lands mid-gesture
	// may name a different route owner (a boost that boots or releases between
	// two key presses), and repainting on it made the pill flash violet then
	// blue on the SAME 110% value, once per press. The transaction's decision
	// stands until the gesture settles; the next gesture reads the new fact.
	if (hotkey.phase === 'active') return;
	const target = hotkey.target;
	if (target.type !== 'volume' || target.value <= 0) return;
	const tone = resolveTone(target.value);
	if (tone === target.tone) return;
	hotkey.tone = tone;
	const next: VolumeOSDPayload = { ...target, tone };
	hotkey.target = next;
	if (hotkey.settlement?.actual.type === 'volume') {
		hotkey.settlement.actual = { ...hotkey.settlement.actual, tone };
	}
	if (state.presentation?.type === 'volume') state.presentation = next;
	paintOSDColor(state.root, next);
}

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

function scheduleOSDHide(): void {
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => {
		concealOSD();
		if (state.hotkey) state.hotkey.phase = 'settled';
	}, OSD_HIDE_DELAY_MS);
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
	const muted = payload.tone === 'muted';
	text.textContent = muted
		? s.osdMessages.muted
		: `${Number.isInteger(target) ? target : target.toFixed(1)}%`;
	icon.textContent = muted ? '🔇' : (target > 100 ? '🚀' : '🔊');
}

function animateScalarValue(
	root: ShadowRoot,
	payload: OSDPayload,
	s: ContentGlobalSettings,
): void {
	cancelValueAnimation();
	const targetAt = performance.now();
	const targetIntervalMs = state.hotkey !== null
		&& state.lastType === payload.type
		&& state.lastTargetAt !== null
		? targetAt - state.lastTargetAt
		: undefined;
	state.lastTargetAt = targetAt;
	const from = state.lastType === payload.type && state.displayedValue !== null
		? state.displayedValue
		: payload.value;
	const to = payload.value;
	if (payload.type === 'volume' && payload.tone === 'muted'
		|| from === to) {
		state.displayedValue = to;
		paintScalarValue(root, payload, to, s);
		return;
	}
	// A held hotkey emits targets faster than a fixed ease can finish. When this
	// update is part of a continuous gesture (the previous target landed only a
	// moment ago), commit the live value immediately so the bar, number and tone
	// track the key-repeat instead of perpetually chasing one step behind and
	// then jumping when the actual ACK lands. An isolated, discrete press keeps
	// the short easing for a smooth single-step feel.
	if (targetIntervalMs !== undefined && targetIntervalMs <= 120) {
		state.displayedValue = to;
		paintScalarValue(root, payload, to, s);
		return;
	}
	const duration = scalarFeedbackAnimationDuration(payload.type, from, to, targetIntervalMs);
	// Commit the discrete shortcut target in the input task while preserving the
	// current interpolated fill. A busy frame cannot swallow a physical step's
	// integer label merely because the next keydown arrives before rAF.
	paintScalarValue(root, payload, from, s);
	let startedAt: number | null = null;
	const step = (now: number): void => {
		startedAt ??= now;
		const progress = Math.min(1, (now - startedAt) / duration);
		const desired = from + (to - from) * progress;
		const current = state.displayedValue ?? from;
		const remaining = desired - current;
		const maxFrameDelta = state.hotkey === null
			? Math.abs(remaining)
			: scalarFeedbackMaxFrameDelta(payload.type);
		const value = Math.abs(remaining) <= maxFrameDelta
			? desired
			: current + Math.sign(remaining) * maxFrameDelta;
		state.displayedValue = value;
		paintScalarValue(root, payload, value, s);
		if (progress < 1 || Math.abs(to - value) > Number.EPSILON) {
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
	state.presentation = null;
	state.lastTargetAt = null;
	state.lastType = null;
}

// Keyup terminates motion but not readability. Preserve the exact final
// number/width/tone frame synchronously, then give it a fresh display window.
// The gesture identity remains until the in-flight ACK settles. Settlement may
// correct the final value once, without restarting animation or display time.
export function freezeHotkeyTargetOSD(gesture: string): void {
	if (state.disposed || state.hotkey?.gesture !== gesture) return;
	if (state.hotkey.phase === 'active') state.hotkey.phase = 'frozen';
	cancelValueAnimation();
	state.root?.getElementById('o')?.classList.add('v');
	state.lastTargetAt = null;
	scheduleOSDHide();
}

export function releaseHotkeyTargetOSD(gesture: string): void {
	if (state.disposed || state.hotkey?.gesture !== gesture) return;
	if (state.timer === null) {
		state.hotkey = null;
		return;
	}
	const hotkey = state.hotkey;
	hotkey.phase = 'settled';
	const settlement = hotkey.settlement;
	if (!settlement) return;
	const presentation = resolveHotkeyReleasePresentation(
		gesture,
		hotkey.gesture,
		hotkey.target,
		settlement.actual,
	);
	if (!presentation) return;
	hotkey.settlement = null;
	hotkey.target = presentation;
	renderOSD(
		presentation,
		settlement.settings,
		settlement.options,
		false,
		false,
	);
}

// eff: core OSD rendering logic, handles both volume and speed display modes
function renderOSD(
	payload: OSDPayload,
	s: ContentGlobalSettings,
	options: OSDOptions,
	animate = true,
	refreshHide = true,
): void {
	if (state.disposed) return;
	if (!state.host?.isConnected || !state.root) {
		const surface = createFeedbackSurface(
			'spectra-osd-host',
			'position:fixed;top:15%;left:50%;transform:translateX(-50%);z-index:2147483647',
		);
		const h = surface.host;
		const ws = surface.root;
		const css = document.createElement('style');
		css.textContent = `.o{background:${UI_COLORS.OSD_SURFACE};backdrop-filter:blur(8px);padding:12px 20px;border-radius:30px;color:${UI_COLORS.TOAST_TEXT};display:grid;gap:4px;font-family:system-ui;transition:0.2s;opacity:0;transform:translateY(-10px)}.v{opacity:1;transform:translateY(0)}.r{display:flex;align-items:center;gap:12px}.g{width:160px;height:26px;position:relative;flex:none}.b{position:absolute;left:0;right:0;top:10px;height:6px;background:${UI_COLORS.OSD_TRACK};border-radius:3px;overflow:hidden}.f{height:100%;width:0%}.marks{position:absolute;inset:0;pointer-events:none}.mk{position:absolute;top:9px;width:1px;height:8px;background:${UI_COLORS.OSD_MARK};transform:translateX(-.5px);z-index:5}.mk::after{content:attr(data-label);position:absolute;left:50%;transform:translateX(-50%);font-size:8px;line-height:9px;font-weight:600;white-space:nowrap;color:${UI_COLORS.OSD_MARK_LABEL}}.mk.upper::after{bottom:9px}.mk.lower::after{top:9px}.t{font-weight:600;font-size:14px;min-width:58px;text-align:right;font-variant-numeric:tabular-nums}.meta{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:11px;opacity:.78}.meta[hidden]{display:none}`;

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
	paintOSDColor(state.root, payload);
	const alternate = options.variant === 'alternate-target';
	meta.toggleAttribute('hidden', !alternate);
	meta.textContent = alternate
		? `↗ ${options.targetTitle || options.targetHostname || ''}${options.targetTitle && options.targetHostname ? ` · ${options.targetHostname}` : ''}`
		: '';

	if (state.lastType !== payload.type) renderMarkers(state.root, payload.type);
	state.presentation = payload;
	if (animate) {
		animateScalarValue(state.root, payload, s);
	} else {
		cancelValueAnimation();
		state.displayedValue = payload.value;
		paintScalarValue(state.root, payload, payload.value, s);
	}
	state.lastType = payload.type;
	if (refreshHide) scheduleOSDHide();
}

// eff: removes feedback immediately only at a real lifecycle boundary.
export function hideOSD(preserveShortcutTarget = false): void {
	state.pendingVolume = null;
	if (state.timer) clearTimeout(state.timer);
	concealOSD();
	if (!preserveShortcutTarget) {
		state.hotkey = null;
		state.claimedGesture = null;
	}
}

// eff: cancels all retained presentation work and rejects late generation ACKs.
export function disposeOSD(): void {
	state.pendingVolume = null;
	state.disposed = true;
	if (state.timer) clearTimeout(state.timer);
	state.timer = null;
	cancelValueAnimation();
	state.host?.remove();
	state.host = null;
	state.root = null;
	state.displayedValue = null;
	state.presentation = null;
	state.hotkey = null;
	state.claimedGesture = null;
	state.lastTargetAt = null;
	state.lastType = null;
}
