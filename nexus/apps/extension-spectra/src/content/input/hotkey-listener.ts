// goal: intercepts keyboard events for site-specific custom hotkeys
// eff: non-candidates allocate nothing; each candidate owns one same-event tail

import type {
	HotkeySettings,
	HotkeyBinding,
	SiteHotkeyConfig,
} from '@nexus/contracts';
import {
	DEFAULT_HOTKEY_SETTINGS,
	findBestHostnameMatch,
	isSpectraEventEnvelope,
	normalizeHostname,
	resolveAudioVolume,
	resolveAudioVolumeState,
	resolveSpectraHotkeyActualFeedback,
	resolveSpectraDefaultHotkeyAction,
	selectHotkeyFeedbackOwner,
	selectHotkeyRepeatPolicy,
} from '@nexus/contracts';
import { createLogger } from '../../shared/logger';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { createEventListener, createCleanupManager } from '../utils/timing';
import { executeHotkeyAction } from './hotkey-actions';
import {
	createWebsiteFirstKeyboardArbiter,
	isEditableHotkeyEvent,
	isTrustedHotkeyEvent,
} from './hotkey-event';
import {
	nextScalarGestureId,
	isHotkeyGestureReleased,
	subscribeHotkeyReplay,
	subscribePhysicalHotkeyRelease,
	type DefaultScalarGestureSignal,
	type PhysicalHotkeyReleaseSignal,
} from './default-scalar-gesture';
import {
	freezeHotkeyToast,
	hideToast,
	releaseHotkeyToast,
	showToast,
} from '../ui/toast';
import {
	advanceHotkeyTargetOSD,
	claimHotkeyActualOSDGesture,
	freezeHotkeyTargetOSD,
	hideOSD,
	admitsHotkeyActualOSDGesture,
	releaseHotkeyTargetOSD,
	showHotkeyActualOSD,
} from '../ui/osd';
import type { SettingsManager } from '../core/settings-manager';
import type { PolicyExecutorState } from '../types';

const log = createLogger('Hotkeys');

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };
let cachedSite: SiteHotkeyConfig | null | undefined;
let cachedBindings: Map<string, HotkeyBinding> | undefined;
let lastHostname = '';
const inFlightGestures = new Set<string>();
// A gesture is released while its action is still in flight, and the action's
// own settlement is what drains the entry. That settlement lives in another
// subsystem, so this set has no self-evident upper bound: a tab that is hidden
// mid-execution, repeatedly, would grow it for the lifetime of the document
// (SP-53). The oldest entry is the least likely to still matter, and dropping
// it only costs one stale release call.
const releasedFeedbackGestures = new Set<string>();
const MAX_RELEASED_FEEDBACK_GESTURES = 64;
const pendingRepeatPulses = new Map<string, number>();
const lastRepeatExecutionAt = new Map<string, number>();
interface ActiveHotkeyBinding {
	binding: HotkeyBinding;
	repeated: boolean;
	feedbackGesture: string;
}
const activeBindingsByCode = new Map<string, ActiveHotkeyBinding>();
const MAX_REPEAT_BURST_PULSES = 160;
const REPEAT_EXECUTION_INTERVAL_MS = 50;
let keydownDisposer: (() => void) | null = null;
let contentSettings: Pick<SettingsManager, 'get'> | undefined;
type FeedbackState = Pick<
	PolicyExecutorState,
	'appliedConfig' | 'actualMode' | 'phase'
>;
let feedbackState: FeedbackState | undefined;

interface LeanSiteHotkeyMarker {
	revision?: unknown;
	active?: unknown;
}

interface LeanSiteHotkeyWindow extends Window {
	__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: LeanSiteHotkeyMarker;
}

function leanSiteHotkeyOwnsConfiguredBindings(): boolean {
	const marker = (window as LeanSiteHotkeyWindow).__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
	return marker?.revision === 2 && marker.active === true;
}

function markFeedbackGestureReleased(gesture: string): void {
	if (releasedFeedbackGestures.size >= MAX_RELEASED_FEEDBACK_GESTURES) {
		// Sets iterate in insertion order, so the first entry is the oldest.
		const oldest = releasedFeedbackGestures.values().next().value;
		if (oldest !== undefined) releasedFeedbackGestures.delete(oldest);
	}
	releasedFeedbackGestures.add(gesture);
}

function cancelActiveBindings(): void {
	for (const held of activeBindingsByCode.values()) {
		if (inFlightGestures.has(held.feedbackGesture)) {
			markFeedbackGestureReleased(held.feedbackGesture);
		} else {
			releaseHotkeyToast(held.feedbackGesture);
			releaseHotkeyTargetOSD(held.feedbackGesture);
		}
	}
	activeBindingsByCode.clear();
	pendingRepeatPulses.clear();
	lastRepeatExecutionAt.clear();
	hideToast();
	hideOSD(true);
}

function synchronizeKeydownListener(): void {
	const shouldListen = getSiteConfig() !== null;
	if (shouldListen && !keydownDisposer) {
		keydownDisposer = createWebsiteFirstKeyboardArbiter({
			type: 'keydown',
			resolveCandidate: resolveSiteHotkeyBinding,
			onSettled: (event, binding, websiteClaimed) => {
				if (!websiteClaimed) handleKeydown(event, binding);
			},
		});
	} else if (!shouldListen && keydownDisposer) {
		cancelActiveBindings();
		keydownDisposer();
		keydownDisposer = null;
	}
}

export async function initHotkeyListener(
	settingsManager?: Pick<SettingsManager, 'get'>,
	state?: Pick<PolicyExecutorState, 'appliedConfig' | 'actualMode' | 'phase'>,
): Promise<() => void> {
	contentSettings = settingsManager;
	feedbackState = state;
	await loadSettings();
	const cleanup = createCleanupManager();

	cleanup.add(subscribePhysicalHotkeyRelease(releaseSiteHotkeys));
	synchronizeKeydownListener();
	cleanup.add(subscribeHotkeyReplay((signal) => {
		if (signal.type === 'gesture') handleDefaultScalarGesture(signal.signal);
		else handleHotkeyActualFeedback(signal.message);
	}));
	cleanup.add(createEventListener(window, 'blur', cancelActiveBindings));
	cleanup.add(createEventListener(window, 'pagehide', cancelActiveBindings));
	cleanup.add(createEventListener(document, 'visibilitychange', () => {
		if (document.hidden) cancelActiveBindings();
	}));

	chrome.runtime.onMessage.addListener(handleSettingsEvent);
	cleanup.add(() => chrome.runtime.onMessage.removeListener(handleSettingsEvent));
	cleanup.add(() => {
		keydownDisposer?.();
		keydownDisposer = null;
		cancelActiveBindings();
		if (contentSettings === settingsManager) contentSettings = undefined;
		if (feedbackState === state) feedbackState = undefined;
	});

	log.info('Hotkey listener initialized');
	return cleanup.dispose;
}

function handleHotkeyActualFeedback(message: unknown): void {
	if (isSpectraEventEnvelope(message) && message.type === 'spectra.hotkey.target.feedback') {
		if (message.payload.gesture) {
			if (!admitsHotkeyActualOSDGesture(
				message.payload.gesture,
				!isHotkeyGestureReleased(message.payload.gesture),
			)) {
				return;
			}
			claimHotkeyActualOSDGesture(message.payload.gesture);
		}
		const options = message.payload.targetTabId === message.tabId
			? {}
			: {
				variant: 'alternate-target' as const,
				targetTitle: message.payload.targetTitle,
				targetHostname: message.payload.targetHostname,
		};
		if (message.payload.feedback && contentSettings) {
			showHotkeyActualOSD(
				message.payload.feedback,
				contentSettings.get(),
				options,
				message.payload.gesture,
			);
		} else {
			showToast(formatLabel(message.payload.action), options);
		}
	}
}

function handleSettingsEvent(message: unknown, sender?: chrome.runtime.MessageSender): false {
	// This listener rewrites the live hotkey bindings, so it must prove who sent
	// the event. Every other Content entry point checks `sender.id`; this one
	// never did, so a well-formed `spectra.hotkeys.changed` from any context that
	// reaches the runtime could replace the bindings (INV-11).
	if (sender?.id !== undefined && sender.id !== chrome.runtime.id) return false;
	if (isSpectraEventEnvelope(message) && message.type === 'spectra.hotkeys.changed') {
		cancelActiveBindings();
		settings = message.payload;
		cachedSite = undefined;
		cachedBindings = undefined;
		synchronizeKeydownListener();
		log.debug('Settings updated');
	}
	return false;
}

async function loadSettings(): Promise<void> {
	try {
		const result = await sendSpectraRequest('spectra.hotkeys.get', {});
		if (result.ok) settings = result.data;
	} catch (error) {
		settings = DEFAULT_HOTKEY_SETTINGS;
		log.warn('Unable to load hotkey settings; using defaults', error);
	}
}

function getSiteConfig(): SiteHotkeyConfig | null {
	// The lean exact host is the physical configured-site owner. A transient
	// heavy runtime may still exist for unrelated capabilities, but it must not
	// attach a second listener even if it retained an older cached site match.
	if (leanSiteHotkeyOwnsConfiguredBindings()) return null;
	if (location.hostname === lastHostname && cachedSite !== undefined) return cachedSite;
	lastHostname = location.hostname;
	const hostname = normalizeHostname(lastHostname);
	if (!hostname) {
		cachedSite = null;
		return cachedSite;
	}

	const match = findBestHostnameMatch(hostname, Object.entries(settings.sites), ([domain]) => domain);
	const site = match?.[1];
	cachedSite = site?.enabled ? site : null;
	cachedBindings = undefined;
	return cachedSite;
}

function bindingKey(code: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean): string {
	return `${code}:${ctrl ? 1 : 0}${alt ? 1 : 0}${shift ? 1 : 0}${meta ? 1 : 0}`;
}

function getBindingMap(site: SiteHotkeyConfig): Map<string, HotkeyBinding> {
	if (cachedBindings) return cachedBindings;
	const bindings = new Map<string, HotkeyBinding>();
	for (const binding of site.bindings) {
		if (!binding.enabled || binding.disabledReason) continue;
		const { code, modifiers } = binding.key;
		bindings.set(bindingKey(
			code,
			modifiers.ctrl,
			modifiers.alt,
			modifiers.shift,
			modifiers.meta,
		), binding);
	}
	cachedBindings = bindings;
	return bindings;
}

// Browser navigation shortcuts always belong to the browser. Allowing a site
// binding to claim them displayed SPECTRA feedback immediately before reload,
// which looked like a toast emitted by the refreshed document.
function isBrowserRefreshShortcut(e: KeyboardEvent): boolean {
	return e.code === 'F5'
		|| (e.code === 'KeyR' && !e.altKey && (e.ctrlKey || e.metaKey));
}

function nextFeedbackGesture(): string {
	return nextScalarGestureId('site');
}

function volumeFeedback(value: number, current: FeedbackState) {
	return {
		kind: 'volume' as const,
		value,
		volumeState: resolveAudioVolumeState({
			volume: value,
			muted: current.appliedConfig.muted,
			actualMode: current.actualMode,
			phase: current.phase,
		}),
	};
}

function advanceScalarFeedbackTarget(
	kind: 'speed' | 'volume',
	delta: number,
	gesture: string,
): void {
	if (!contentSettings || !feedbackState) return;
	const baseline = kind === 'speed'
		? { kind, value: feedbackState.appliedConfig.speed } as const
		: volumeFeedback(resolveAudioVolume(feedbackState.appliedConfig).effectiveVolume, feedbackState);
	advanceHotkeyTargetOSD(
		baseline,
		delta,
		contentSettings.get(),
		gesture,
	);
}

function handleDefaultScalarGesture(signal: DefaultScalarGestureSignal): void {
	const kind = signal.action.startsWith('speed_') ? 'speed' : 'volume';
	if (signal.phase === 'release') {
		if (signal.repeated) freezeHotkeyTargetOSD(signal.gesture);
		return;
	}
	if (signal.phase === 'settled') {
		releaseHotkeyTargetOSD(signal.gesture);
		return;
	}
	claimHotkeyActualOSDGesture(signal.gesture);
	if (signal.action === 'volume_mute') return;
	if (!contentSettings || !feedbackState) return;
	const direction = signal.action.endsWith('_up') ? 1 : -1;
	const step = kind === 'speed' ? 0.1 : 10;
	advanceScalarFeedbackTarget(kind, direction * step, signal.gesture);
}

function addRepeatPulse(gesture: string): void {
	pendingRepeatPulses.set(
		gesture,
		Math.min(MAX_REPEAT_BURST_PULSES, (pendingRepeatPulses.get(gesture) ?? 0) + 1),
	);
}

function takeRepeatPulses(gesture: string): number {
	const pulses = pendingRepeatPulses.get(gesture) ?? 0;
	pendingRepeatPulses.delete(gesture);
	return pulses;
}

function scalarBindingStep(binding: HotkeyBinding): number {
	const configuredStep = binding.params?.step;
	return typeof configuredStep === 'number' && Number.isFinite(configuredStep)
		? Math.abs(configuredStep)
		: binding.action.startsWith('speed_') ? 0.1 : 10;
}

function coalescedBinding(binding: HotkeyBinding, pulses: number): HotkeyBinding {
	if (pulses <= 1) return binding;
	const step = scalarBindingStep(binding);
	if (binding.action === 'speed_up' || binding.action === 'speed_down') {
		return {
			...binding,
			params: {
				...binding.params,
				step: Math.min(16, Math.round(step * pulses * 1000) / 1000),
			},
		};
	}
	if (binding.action === 'volume_up' || binding.action === 'volume_down') {
		return {
			...binding,
			params: { ...binding.params, step: Math.min(800, step * pulses) },
		};
	}
	// Discrete repeatable operations coalesce to one execution; they cannot be
	// converted into a larger scalar without changing their semantics.
	return binding;
}

function scalarFeedbackDelta(binding: HotkeyBinding): number | null {
	const step = scalarBindingStep(binding);
	switch (binding.action) {
		case 'speed_up':
		case 'volume_up': return step;
		case 'speed_down':
		case 'volume_down': return -step;
		default: return null;
	}
}

function advanceBindingFeedbackTarget(
	binding: HotkeyBinding,
	gesture: string,
): void {
	const delta = scalarFeedbackDelta(binding);
	if (delta === null) return;
	const kind = binding.action.startsWith('speed_') ? 'speed' : 'volume';
	advanceScalarFeedbackTarget(kind, delta, gesture);
}

function commitHotkeyActualFeedback(
	binding: HotkeyBinding,
	gesture: string,
	result: unknown,
): void {
	if (!contentSettings) return;
	const feedback = resolveSpectraHotkeyActualFeedback(binding.action, result);
	if (!feedback) return;
	showHotkeyActualOSD(
		feedback,
		contentSettings.get(),
		{},
		gesture,
	);
}

function executeBinding(
	binding: HotkeyBinding,
	withOSD: boolean,
	feedbackGesture: string,
): void {
	if (inFlightGestures.has(feedbackGesture)) return;
	inFlightGestures.add(feedbackGesture);
	const execution = withOSD
		? executeWithOSD(binding, feedbackGesture)
		: executeHotkeyAction(binding.action, binding.params);
	void execution
		.then((result) => commitHotkeyActualFeedback(binding, feedbackGesture, result))
		.catch((error) => {
			log.warn(`Hotkey ${binding.action} failed`, error);
			if (withOSD) showToast(error instanceof Error ? error.message : String(error), {
				shortcutGesture: feedbackGesture,
			});
		})
		.finally(() => {
		inFlightGestures.delete(feedbackGesture);
		if (releasedFeedbackGestures.delete(feedbackGesture)) {
			releaseHotkeyToast(feedbackGesture);
			releaseHotkeyTargetOSD(feedbackGesture);
		}
		});
}

function resolveSiteHotkeyBinding(e: KeyboardEvent): HotkeyBinding | null {
	if (!isTrustedHotkeyEvent(e)) return null;
	if (isBrowserRefreshShortcut(e)) return null;
	if (resolveSpectraDefaultHotkeyAction(e) !== null) return null;
	const site = getSiteConfig();
	if (!site) return null;
	if (isEditableHotkeyEvent(e)) return null;

	const binding = getBindingMap(site).get(bindingKey(
		e.code,
		e.ctrlKey,
		e.altKey,
		e.shiftKey,
		e.metaKey,
	));
	if (!binding) return null;
	if (e.repeat && (selectHotkeyRepeatPolicy(binding.action) !== 'coalesce-20hz'
		|| !activeBindingsByCode.has(e.code))) return null;
	return binding;
}

function handleKeydown(e: KeyboardEvent, binding: HotkeyBinding): void {
	const repeatPolicy = selectHotkeyRepeatPolicy(binding.action);
	e.preventDefault();
	if (!e.repeat) releaseSiteHotkeys({ code: e.code });
	const active = e.repeat ? activeBindingsByCode.get(e.code) : undefined;
	const held: ActiveHotkeyBinding = {
		binding,
		repeated: e.repeat || active?.repeated === true,
		feedbackGesture: active?.feedbackGesture ?? nextFeedbackGesture(),
	};
	if (!e.repeat && repeatPolicy === 'coalesce-20hz') {
		advanceBindingFeedbackTarget(binding, held.feedbackGesture);
	}
	activeBindingsByCode.set(e.code, held);
	if (repeatPolicy !== 'coalesce-20hz' || !e.repeat) {
		// First press (non-repeat) OR a non-coalesce action: execute immediately
		// WITH the OSD toast. The toast is the once-per-press signal that the
		// hotkey fired — it must not be re-shown on every keydown repeat, or the
		// OSD floods and appears "stuck on" while the user holds the key.
		executeBinding(binding, true, held.feedbackGesture);
		return;
	}
	advanceBindingFeedbackTarget(held.binding, held.feedbackGesture);
	// Only a new physical repeat may consume accumulated pulses. There is no
	// trailing action timer, so even an unobservable keyup cannot create motion
	// after the physical event stream has stopped.
	addRepeatPulse(held.feedbackGesture);
	if (inFlightGestures.has(held.feedbackGesture)) return;
	const lastExecutionAt = lastRepeatExecutionAt.get(held.feedbackGesture);
	if (lastExecutionAt !== undefined
		&& e.timeStamp - lastExecutionAt < REPEAT_EXECUTION_INTERVAL_MS) return;
	lastRepeatExecutionAt.set(held.feedbackGesture, e.timeStamp);
	executeBinding(
		coalescedBinding(binding, takeRepeatPulses(held.feedbackGesture)),
		false,
		held.feedbackGesture,
	);
}

function modifierForCode(code: string): keyof HotkeyBinding['key']['modifiers'] | null {
	return code.startsWith('Control') ? 'ctrl'
		: code.startsWith('Alt') ? 'alt'
			: code.startsWith('Shift') ? 'shift'
				: code.startsWith('Meta') ? 'meta'
					: null;
}

function releaseSiteHotkeys(signal: PhysicalHotkeyReleaseSignal): void {
	let releasedRepeated = false;
	const released: ActiveHotkeyBinding[] = [];
	const active = activeBindingsByCode.get(signal.code);
	if (active) {
		activeBindingsByCode.delete(signal.code);
		pendingRepeatPulses.delete(active.feedbackGesture);
		lastRepeatExecutionAt.delete(active.feedbackGesture);
		releasedRepeated = active.repeated;
		released.push(active);
	}

	const modifier = modifierForCode(signal.code);
	if (modifier) {
		for (const [code, held] of activeBindingsByCode) {
			if (!held.binding.key.modifiers[modifier]) continue;
			activeBindingsByCode.delete(code);
			pendingRepeatPulses.delete(held.feedbackGesture);
			lastRepeatExecutionAt.delete(held.feedbackGesture);
			releasedRepeated ||= held.repeated;
			released.push(held);
		}
	}

	// A tap keeps its original window. A held shortcut stops moving at keyup,
	// commits its final frame, and receives a fresh readable display window.
	if (releasedRepeated && ![...activeBindingsByCode.values()].some((held) => held.repeated)) {
		for (const held of released) {
			if (!held.repeated) continue;
			freezeHotkeyToast(held.feedbackGesture);
			freezeHotkeyTargetOSD(held.feedbackGesture);
		}
	}
	for (const held of released) {
		if (inFlightGestures.has(held.feedbackGesture)) {
			markFeedbackGestureReleased(held.feedbackGesture);
		} else {
			releaseHotkeyToast(held.feedbackGesture);
			releaseHotkeyTargetOSD(held.feedbackGesture);
		}
	}
}

async function executeWithOSD(b: HotkeyBinding, feedbackGesture: string): Promise<unknown> {
	const action = b.action;
	const feedbackOwner = selectHotkeyFeedbackOwner(action);
	if (feedbackOwner === 'actual-osd') {
		claimHotkeyActualOSDGesture(feedbackGesture);
	}
	// Show toast immediately for instant feedback, before awaiting the action
	if (feedbackOwner === 'listener-label') {
		showToast(formatLabel(action, b.params), { shortcutGesture: feedbackGesture });
	}
	return executeHotkeyAction(action, b.params);
}

function formatLabel(action: string, p?: { step?: number }): string {
	const s = p?.step;
	switch (action) {
		case 'play_pause': return '⏯️';
		case 'speed_up': return `⏩ +${s ?? 0.1}x`;
		case 'speed_down': return `⏪ -${s ?? 0.1}x`;
		case 'speed_reset': return '🔄 1x';
		case 'volume_up': return `🔊 +${s ?? 10}`;
		case 'volume_down': return `🔉 -${s ?? 10}`;
		case 'volume_mute': return '🔇';
		case 'fullscreen_toggle': return '📺';
		case 'pip_toggle': return '🖼️';
		default: return action.replace(/_/g, ' ');
	}
}
