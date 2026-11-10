// goal: contract for hotkey management including actions, bindings, and configurations

import type { AudioVolumeState } from './audio.contracts.js';
import { isFiniteControlValue } from './control-value-limits.js';
import type { VolumeTone } from './volume-presentation.contracts.js';
import type {
	ControlApplyAck,
	ControlCapability,
} from './control.contracts.js';
import {
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	resolveSpectraDefaultHotkeyAction,
} from './spectra.bootstrap.js';

export type HotkeyAvailability = 'enabled' | 'no-op' | 'disabled-legacy';
export type HotkeyRepeatPolicy = 'coalesce-20hz' | 'ignore-repeat' | 'single';
export type HotkeyParameterKind = 'none' | 'speed' | 'volume' | 'script' | 'url';
export type HotkeyFeedbackOwner = 'actual-osd' | 'handler-result' | 'listener-label' | 'none';

export interface HotkeyActionDescriptor {
	capability: ControlCapability | null;
	availability: HotkeyAvailability;
	repeatPolicy: HotkeyRepeatPolicy;
	requiresUserActivation: boolean;
	parameter: HotkeyParameterKind;
	feedbackOwner: HotkeyFeedbackOwner;
}

const FEEDBACK_HANDLER = 1;
const FEEDBACK_LISTENER = 2;
const FEEDBACK_NONE = 3;
const REPEAT_IGNORE = 1 << 2;
const REPEAT_SINGLE = 2 << 2;
const USER_ACTIVATION = 1 << 4;
const PARAM_SPEED = 1 << 5;
const PARAM_VOLUME = 2 << 5;
const PARAM_SCRIPT = 3 << 5;
const PARAM_URL = 4 << 5;
const AVAILABILITY_NOOP = 1 << 8;
const AVAILABILITY_DISABLED = 2 << 8;

// The tuple is [canonical capability, packed policy dimensions]. Zero values
// mean actual-osd, coalesce-20hz, no activation, no parameter and enabled.
// This is the sole persisted-action disposition owner; human-readable audit
// descriptors and every production selector are derived from this index.
const HOTKEY_ACTION_INDEX = {
	none: [null, FEEDBACK_NONE | REPEAT_IGNORE | AVAILABILITY_NOOP],
	play_pause: ['playback-toggle', FEEDBACK_LISTENER | REPEAT_IGNORE | USER_ACTIVATION],
	seek_forward_5s: ['seek-relative', FEEDBACK_LISTENER],
	seek_forward_10s: ['seek-relative', FEEDBACK_LISTENER],
	seek_forward_30s: ['seek-relative', FEEDBACK_LISTENER],
	seek_backward_5s: ['seek-relative', FEEDBACK_LISTENER],
	seek_backward_10s: ['seek-relative', FEEDBACK_LISTENER],
	seek_backward_30s: ['seek-relative', FEEDBACK_LISTENER],
	seek_frame_forward: ['frame-step', FEEDBACK_LISTENER],
	seek_frame_backward: ['frame-step', FEEDBACK_LISTENER],
	speed_up: ['speed', 0],
	speed_down: ['speed', 0],
	speed_reset: ['speed', REPEAT_IGNORE],
	speed_set: ['speed', REPEAT_IGNORE | PARAM_SPEED],
	volume_up: ['effective-volume', 0],
	volume_down: ['effective-volume', 0],
	volume_mute: ['mediaMuted', REPEAT_IGNORE],
	volume_set: ['effective-volume', REPEAT_IGNORE | PARAM_VOLUME],
	audio_reset: ['audio-reset', REPEAT_IGNORE],
	gain_up: ['effective-volume', 0],
	gain_down: ['effective-volume', 0],
	pitch_up: [null, FEEDBACK_HANDLER | REPEAT_IGNORE | AVAILABILITY_DISABLED],
	pitch_down: [null, FEEDBACK_HANDLER | REPEAT_IGNORE | AVAILABILITY_DISABLED],
	pitch_reset: [null, FEEDBACK_HANDLER | REPEAT_IGNORE | AVAILABILITY_DISABLED],
	delay_up: ['delay', FEEDBACK_LISTENER],
	delay_down: ['delay', FEEDBACK_LISTENER],
	delay_reset: ['delay', FEEDBACK_LISTENER | REPEAT_IGNORE],
	pan_left: ['pan', FEEDBACK_LISTENER],
	pan_right: ['pan', FEEDBACK_LISTENER],
	pan_reset: ['pan', FEEDBACK_LISTENER | REPEAT_IGNORE],
	mono_toggle: ['mono', FEEDBACK_LISTENER | REPEAT_IGNORE],
	capture_toggle: [null, FEEDBACK_HANDLER | REPEAT_IGNORE | AVAILABILITY_DISABLED],
	fullscreen_toggle: ['fullscreen', FEEDBACK_LISTENER | REPEAT_IGNORE | USER_ACTIVATION],
	pip_toggle: ['pip', FEEDBACK_LISTENER | REPEAT_IGNORE | USER_ACTIVATION],
	rotate_cw: ['rotation', FEEDBACK_LISTENER | REPEAT_IGNORE],
	rotate_ccw: ['rotation', FEEDBACK_LISTENER | REPEAT_IGNORE],
	mirror_toggle: ['mirrored', FEEDBACK_LISTENER | REPEAT_IGNORE],
	screenshot: ['screenshot', FEEDBACK_LISTENER | REPEAT_SINGLE | USER_ACTIVATION],
	dim_background: ['dimEnabled', FEEDBACK_LISTENER | REPEAT_IGNORE],
	marker_add: ['marker-add', FEEDBACK_HANDLER | REPEAT_IGNORE],
	marker_jump_prev: ['marker-jump-previous', FEEDBACK_HANDLER],
	marker_jump_next: ['marker-jump-next', FEEDBACK_HANDLER],
	ab_set_a: ['ab-set-a', FEEDBACK_HANDLER | REPEAT_IGNORE],
	ab_set_b: ['ab-set-b', FEEDBACK_HANDLER | REPEAT_IGNORE],
	ab_clear: ['ab-clear', FEEDBACK_HANDLER | REPEAT_IGNORE],
	ab_skip: ['ab-skip', FEEDBACK_HANDLER],
	loop_toggle: ['loop', FEEDBACK_LISTENER | REPEAT_IGNORE],
	fx_toggle: ['video-effects-toggle', FEEDBACK_LISTENER | REPEAT_IGNORE],
	fx_reset: ['video-effects-reset', FEEDBACK_LISTENER | REPEAT_IGNORE],
	tab_pin: ['tabPinned', FEEDBACK_LISTENER | REPEAT_IGNORE],
	tab_mute: ['tabMuted', FEEDBACK_LISTENER | REPEAT_IGNORE],
	show_info: ['show-info', FEEDBACK_HANDLER | REPEAT_IGNORE],
	open_popup: ['open-popup', FEEDBACK_NONE | REPEAT_IGNORE],
	open_options: ['open-options', FEEDBACK_NONE | REPEAT_IGNORE],
	run_js: ['run-user-script', FEEDBACK_NONE | REPEAT_IGNORE | PARAM_SCRIPT],
	open_url: ['open-url', FEEDBACK_NONE | REPEAT_IGNORE | PARAM_URL],
} as const satisfies Record<string, readonly [ControlCapability | null, number]>;

export type HotkeyAction = keyof typeof HOTKEY_ACTION_INDEX;

function hotkeyFlags(action: HotkeyAction): number {
	return HOTKEY_ACTION_INDEX[action][1];
}

export function selectHotkeyCapability(action: HotkeyAction): ControlCapability | null {
	return HOTKEY_ACTION_INDEX[action][0];
}

export function selectHotkeyFeedbackOwner(action: HotkeyAction): HotkeyFeedbackOwner {
	switch (hotkeyFlags(action) & 3) {
		case FEEDBACK_HANDLER: return 'handler-result';
		case FEEDBACK_LISTENER: return 'listener-label';
		case FEEDBACK_NONE: return 'none';
		default: return 'actual-osd';
	}
}

export function selectHotkeyRepeatPolicy(action: HotkeyAction): HotkeyRepeatPolicy {
	switch ((hotkeyFlags(action) >>> 2) & 3) {
		case 1: return 'ignore-repeat';
		case 2: return 'single';
		default: return 'coalesce-20hz';
	}
}

export function hotkeyActionRequiresUserActivation(action: HotkeyAction): boolean {
	return (hotkeyFlags(action) & USER_ACTIVATION) !== 0;
}

export function selectHotkeyParameterKind(action: HotkeyAction): HotkeyParameterKind {
	switch ((hotkeyFlags(action) >>> 5) & 7) {
		case 1: return 'speed';
		case 2: return 'volume';
		case 3: return 'script';
		case 4: return 'url';
		default: return 'none';
	}
}

export function selectHotkeyAvailability(action: HotkeyAction): HotkeyAvailability {
	switch ((hotkeyFlags(action) >>> 8) & 3) {
		case 1: return 'no-op';
		case 2: return 'disabled-legacy';
		default: return 'enabled';
	}
}

// The descriptor table is the sole persisted-action key owner. Object.keys
// preserves its declaration order, so the historical public list API remains
// stable without a second hand-maintained action vocabulary.
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = Object.freeze(
	Object.keys(HOTKEY_ACTION_INDEX) as HotkeyAction[],
);

function projectHotkeyActionDescriptors(): Readonly<Record<HotkeyAction, HotkeyActionDescriptor>> {
	return Object.freeze(Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, {
		capability: selectHotkeyCapability(action),
		availability: selectHotkeyAvailability(action),
		repeatPolicy: selectHotkeyRepeatPolicy(action),
		requiresUserActivation: hotkeyActionRequiresUserActivation(action),
		parameter: selectHotkeyParameterKind(action),
		feedbackOwner: selectHotkeyFeedbackOwner(action),
	}])) as Record<HotkeyAction, HotkeyActionDescriptor>);
}

export const HOTKEY_ACTION_DESCRIPTORS = /* @__PURE__ */ projectHotkeyActionDescriptors();

export function selectHotkeyActionDescriptor(action: HotkeyAction): HotkeyActionDescriptor {
	return HOTKEY_ACTION_DESCRIPTORS[action];
}

export type SpectraHotkeyActualFeedback =
	| { kind: 'volume'; value: number; volumeState: AudioVolumeState }
	| { kind: 'speed'; value: number };

export interface SpectraHotkeyPresentationToken {
	owner: string;
	revision: number;
}

export type SpectraHotkeyPresentation =
	| { phase: 'pending'; token: SpectraHotkeyPresentationToken; volume: number; tone: VolumeTone }
	| { phase: 'settled'; token: SpectraHotkeyPresentationToken };

export function isSpectraHotkeyPresentation(value: unknown): value is SpectraHotkeyPresentation {
	if (!isRecord(value) || !isRecord(value.token)
		|| Object.keys(value.token).some(key => key !== 'owner' && key !== 'revision')
		|| typeof value.token.owner !== 'string' || value.token.owner.length === 0 || value.token.owner.length > 256
		|| !Number.isSafeInteger(value.token.revision) || Number(value.token.revision) <= 0) return false;
	if (value.phase === 'settled') return Object.keys(value).every(key => key === 'phase' || key === 'token');
	return value.phase === 'pending'
		&& Object.keys(value).every(key => key === 'phase' || key === 'token' || key === 'volume' || key === 'tone')
		&& isFiniteControlValue(value.volume, 'volume')
		&& (value.tone === 'muted' || value.tone === 'native' || value.tone === 'capture');
}

export function resolveSpectraHotkeyActualFeedback(
	action: HotkeyAction,
	acknowledgement: unknown,
): SpectraHotkeyActualFeedback | undefined {
	if (selectHotkeyFeedbackOwner(action) !== 'actual-osd'
		|| typeof acknowledgement !== 'object'
		|| acknowledgement === null) return undefined;
	const candidate = acknowledgement as Partial<
		Pick<ControlApplyAck, 'fields' | 'audioVolume'>
	>;
	if (action.startsWith('speed_')) {
		const speed = candidate.fields?.speed?.actual;
		return typeof speed === 'number' ? { kind: 'speed', value: speed } : undefined;
	}
	const audioVolume = candidate.audioVolume;
	return audioVolume ? {
		kind: 'volume',
		value: audioVolume.effectiveVolume,
		volumeState: audioVolume.volumeState,
	} : undefined;
}

const HOTKEY_ACTION_SET: ReadonlySet<string> = new Set(HOTKEY_ACTIONS);
const DEFAULT_HOTKEY_ACTION_SET: ReadonlySet<string> = new Set(SPECTRA_DEFAULT_HOTKEY_ACTIONS);

export function isHotkeyAction(value: unknown): value is HotkeyAction {
	return typeof value === 'string' && HOTKEY_ACTION_SET.has(value);
}

// Chrome command slots expose neither physical keyup nor action parameters.
// Keep this runtime predicate beside the exhaustive descriptor table so
// storage normalization, settings patches and command dispatch enforce one
// capability boundary: held/coalesced actions belong to page KeyboardEvents.
export function isSlotHotkeyAction(action: unknown): action is HotkeyAction {
	if (!isHotkeyAction(action)) return false;
	return selectHotkeyAvailability(action) === 'enabled'
		&& !DEFAULT_HOTKEY_ACTION_SET.has(action)
		&& selectHotkeyParameterKind(action) === 'none'
		&& selectHotkeyRepeatPolicy(action) !== 'coalesce-20hz';
}

export interface KeyModifiers {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
}

export interface KeyCombo {
	// code: KeyboardEvent.code
	code: string;
	modifiers: KeyModifiers;
}

// The bootstrap resolver owns the only built-in chord table. Settings,
// persistence and Options project KeyCombo into that resolver instead of
// copying the five reserved combinations into another layer.
export function isSpectraDefaultHotkeyKeyCombo(key: KeyCombo): boolean {
	return resolveSpectraDefaultHotkeyAction({
		code: key.code,
		altKey: key.modifiers.alt,
		ctrlKey: key.modifiers.ctrl,
		shiftKey: key.modifiers.shift,
		metaKey: key.modifiers.meta,
	}) !== null;
}

export interface HotkeyBinding {
	id: string;
	enabled: boolean;
	key: KeyCombo;
	action: HotkeyAction;
	params?: HotkeyParams;
	conditions?: HotkeyConditions;
	disabledReason?: 'unsupported_action' | 'reserved_default_chord';
}

export interface HotkeyParams {
	// inv: speed range 0.1-16
	speed?: number;
	// inv: the only public effective-volume range is 0-800
	volume?: number;
	step?: number;
	script?: string;
	url?: string;
}

const HOTKEY_PARAM_KEYS: ReadonlySet<string> = new Set(['speed', 'volume', 'step', 'script', 'url']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value)
		&& value >= minimum && value <= maximum;
}

function isHttpUrl(value: string): boolean {
	if (value.length === 0 || value.length > 8192) return false;
	try {
		const protocol = new URL(value).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

// Settings can originate from storage written by an older extension. Validate
// action parameters at the contract boundary as well as in Options so a
// missing or malformed parameter cannot be acknowledged as a handled no-op.
export function isHotkeyParamsForAction(
	action: HotkeyAction,
	value: unknown,
): value is HotkeyParams | undefined {
	const required = selectHotkeyParameterKind(action);
	if (value === undefined) return required === 'none';
	if (!isRecord(value) || !Object.keys(value).every((key) => HOTKEY_PARAM_KEYS.has(key))) return false;
	if (value.speed !== undefined && !isFiniteControlValue(value.speed, 'speed')) return false;
	if (value.volume !== undefined && !isFiniteControlValue(value.volume, 'volume')) return false;
	if (value.step !== undefined && !isFiniteInRange(value.step, 0.001, 800)) return false;
	if (value.script !== undefined && (
		typeof value.script !== 'string' || value.script.length === 0 || value.script.length > 100_000
	)) return false;
	if (value.url !== undefined && (typeof value.url !== 'string' || !isHttpUrl(value.url))) return false;
	if (required === 'speed') return value.speed !== undefined;
	if (required === 'volume') return value.volume !== undefined;
	if (required === 'script') return value.script !== undefined;
	if (required === 'url') return value.url !== undefined;
	return value.speed === undefined
		&& value.volume === undefined
		&& value.script === undefined
		&& value.url === undefined;
}

export interface HotkeyConditions {
	// domains: empty fits all (global)
	domains?: string[];
	requireMedia?: boolean;
}

// SlotMapping: chrome.commands names mapped to HotkeyActions
export type SlotMapping = Record<string, HotkeyAction>;

export interface SiteHotkeyConfig {
	enabled: boolean;
	bindings: HotkeyBinding[];
}

export interface HotkeySettings {
	slots: SlotMapping;
	sites: Record<string, SiteHotkeyConfig>;
	disabledLegacyBindings?: HotkeyBinding[];
}

export const DEFAULT_MODIFIERS: Readonly<KeyModifiers> = {
	ctrl: false, alt: false, shift: false, meta: false,
} as const;

export const DEFAULT_HOTKEY_SETTINGS: Readonly<HotkeySettings> = {
	// The five shipped defaults are page-owned so websites can win conflicts.
	slots: {},
	sites: {},
} as const;
