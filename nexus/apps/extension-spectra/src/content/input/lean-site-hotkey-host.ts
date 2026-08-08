// goal: website-first custom hotkeys without a document-lifetime heavy Content Runtime
// inv: content receives only a Background-adjudicated exact-document lean binding projection

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraLeanSiteHotkeyConfigureMessage,
	isSpectraRepeatableDefaultHotkeyAction,
	resolveSpectraDefaultHotkeyAction,
	type SpectraDefaultHotkeyAction,
	type SpectraLeanSiteHotkeyBinding,
} from '@nexus/contracts/bootstrap';
import { runWithValidExtensionContext } from '../core/extension-context';
import {
	createWebsiteFirstKeyboardArbiter,
	isEditableHotkeyEvent,
	isTrustedHotkeyEvent,
	subscribeDocumentStartPhysicalHotkeyRelease,
} from './hotkey-event';

interface LeanSiteHotkeyHost {
	revision: 1;
	dispose(): void;
}

interface LeanSiteHotkeyWindow extends Window {
	__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: LeanSiteHotkeyHost;
}

interface ActiveBinding {
	binding: SpectraLeanSiteHotkeyBinding;
	gesture: string;
	repeated: boolean;
	inFlight: boolean;
	pendingPulses: number;
}

const MAX_PENDING_PULSES = 80;
const hostWindow = window as LeanSiteHotkeyWindow;
const activeByCode = new Map<string, ActiveBinding>();
let bindingByChord = new Map<string, SpectraLeanSiteHotkeyBinding>();
let arbiterDispose: (() => void) | null = null;
let physicalReleaseDispose: (() => void) | null = null;
let runtimeMessageListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | null = null;
let disposed = false;
let configurationEpoch: string | null = null;
let configurationGeneration = -1;

function chordKey(
	code: string,
	ctrl: boolean,
	alt: boolean,
	shift: boolean,
	meta: boolean,
): string {
	return `${code}:${ctrl ? 1 : 0}${alt ? 1 : 0}${shift ? 1 : 0}${meta ? 1 : 0}`;
}

function bindingChord(binding: SpectraLeanSiteHotkeyBinding): string {
	return chordKey(
		binding.code,
		binding.modifiers.ctrl,
		binding.modifiers.alt,
		binding.modifiers.shift,
		binding.modifiers.meta,
	);
}

function eventChord(event: KeyboardEvent): string {
	return chordKey(event.code, event.ctrlKey, event.altKey, event.shiftKey, event.metaKey);
}

function modifierForCode(code: string): keyof SpectraLeanSiteHotkeyBinding['modifiers'] | null {
	return code.startsWith('Control') ? 'ctrl'
		: code.startsWith('Alt') ? 'alt'
			: code.startsWith('Shift') ? 'shift'
				: code.startsWith('Meta') ? 'meta'
					: null;
}

function isBrowserRefreshShortcut(event: KeyboardEvent): boolean {
	return event.code === 'F5'
		|| (event.code === 'KeyR' && !event.altKey && (event.ctrlKey || event.metaKey));
}

function controlRequest(action: SpectraDefaultHotkeyAction, pulses: number): unknown {
	const requestId = crypto.randomUUID();
	if (action === 'volume_up' || action === 'volume_down') {
		return {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId,
			type: 'spectra.control.operation.submit',
			payload: {
				source: 'hotkey',
				target: null,
				operation: 'effective-volume',
				payload: {
					operation: 'delta',
					value: (action === 'volume_up' ? 10 : -10) * pulses,
				},
			},
		};
	}
	if (action === 'volume_mute') {
		return {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId,
			type: 'spectra.control.intent.submit',
			payload: {
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: null,
				mutations: [{ field: 'mediaMuted', operation: 'toggle' }],
			},
		};
	}
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId,
		type: 'spectra.control.intent.submit',
		payload: {
			source: 'hotkey',
			requestedCoverage: 'active-target',
			target: null,
			mutations: [{
				field: 'speed',
				operation: 'delta',
				value: (action === 'speed_up' ? 0.1 : -0.1) * pulses,
			}],
		},
	};
}

function submitPulses(held: ActiveBinding, pulses: number): void {
	if (disposed || held.inFlight || pulses <= 0) return;
	held.inFlight = true;
	void runWithValidExtensionContext(
		() => chrome.runtime.sendMessage(controlRequest(held.binding.action, pulses)),
		dispose,
	).catch(() => undefined).finally(() => {
		held.inFlight = false;
	});
}

function pressBinding(held: ActiveBinding, repeated: boolean): void {
	if (held.binding.action === 'volume_mute' && repeated) return;
	if (held.inFlight) {
		if (repeated) {
			held.pendingPulses = Math.min(MAX_PENDING_PULSES, held.pendingPulses + 1);
			held.repeated = true;
		}
		return;
	}
	const pulses = Math.min(MAX_PENDING_PULSES, held.pendingPulses + 1);
	held.pendingPulses = 0;
	if (repeated) held.repeated = true;
	submitPulses(held, pulses);
}

function releaseHeld(held: ActiveBinding): void {
	// The admitted physical press may finish, but queued repeats never self-drain
	// after keyup/blur/visibility retirement.
	held.pendingPulses = 0;
}

function releaseCode(code: string): void {
	const released: ActiveBinding[] = [];
	const direct = activeByCode.get(code);
	if (direct) {
		activeByCode.delete(code);
		released.push(direct);
	}
	const modifier = modifierForCode(code);
	if (modifier) {
		for (const [heldCode, held] of activeByCode) {
			if (!held.binding.modifiers[modifier]) continue;
			activeByCode.delete(heldCode);
			released.push(held);
		}
	}
	for (const held of released) releaseHeld(held);
}

function releaseAll(): void {
	const released = [...activeByCode.values()];
	activeByCode.clear();
	for (const held of released) releaseHeld(held);
}

function resolveCandidate(event: KeyboardEvent): SpectraLeanSiteHotkeyBinding | null {
	if (!isTrustedHotkeyEvent(event)
		|| isBrowserRefreshShortcut(event)
		|| resolveSpectraDefaultHotkeyAction(event) !== null
		|| isEditableHotkeyEvent(event)) return null;

	if (event.repeat) {
		const active = activeByCode.get(event.code);
		if (!active || !isSpectraRepeatableDefaultHotkeyAction(active.binding.action)) return null;
		return bindingChord(active.binding) === eventChord(event) ? active.binding : null;
	}
	return bindingByChord.get(eventChord(event)) ?? null;
}

function onSettled(
	event: KeyboardEvent,
	binding: SpectraLeanSiteHotkeyBinding,
	websiteClaimed: boolean,
): void {
	if (websiteClaimed || disposed) return;
	event.preventDefault();
	if (!event.repeat) {
		releaseCode(event.code);
		const held: ActiveBinding = {
			binding,
			gesture: `site:${crypto.randomUUID()}`,
			repeated: false,
			inFlight: false,
			pendingPulses: 0,
		};
		activeByCode.set(event.code, held);
		pressBinding(held, false);
		return;
	}
	const held = activeByCode.get(event.code);
	if (!held) return;
	pressBinding(held, true);
}

function syncArbiter(): void {
	const shouldListen = bindingByChord.size > 0;
	if (shouldListen && !arbiterDispose) {
		arbiterDispose = createWebsiteFirstKeyboardArbiter({
			type: 'keydown',
			resolveCandidate,
			onSettled,
		});
	} else if (!shouldListen && arbiterDispose) {
		releaseAll();
		arbiterDispose();
		arbiterDispose = null;
	}
}

function suspendConfiguration(): void {
	releaseAll();
	bindingByChord.clear();
	syncArbiter();
}

function applyConfiguration(
	epoch: string,
	generation: number,
	bindings: readonly SpectraLeanSiteHotkeyBinding[],
): void {
	if (disposed) return;
	if (configurationEpoch === epoch && generation <= configurationGeneration) return;
	if (configurationEpoch !== epoch) {
		configurationEpoch = epoch;
		configurationGeneration = -1;
	}
	configurationGeneration = generation;
	releaseAll();
	bindingByChord = new Map(bindings.map((binding) => [bindingChord(binding), binding]));
	syncArbiter();
}

const onPhysicalRelease = (event: Pick<KeyboardEvent, 'code'>): void => releaseCode(event.code);
const onBlur = (): void => releaseAll();
const onVisibilityChange = (): void => {
	if (document.hidden) releaseAll();
};
const onPageHide = (): void => dispose();

function dispose(): void {
	if (disposed) return;
	disposed = true;
	suspendConfiguration();
	arbiterDispose?.();
	arbiterDispose = null;
	physicalReleaseDispose?.();
	physicalReleaseDispose = null;
	if (runtimeMessageListener) chrome.runtime.onMessage.removeListener(runtimeMessageListener);
	runtimeMessageListener = null;
	window.removeEventListener('blur', onBlur);
	window.removeEventListener('pagehide', onPageHide);
	document.removeEventListener('visibilitychange', onVisibilityChange);
	if (hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__ === host) {
		delete hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
	}
}

const host: LeanSiteHotkeyHost = { revision: 1, dispose };
const existing = hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
if (existing?.revision !== 1) {
	existing?.dispose();
	hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__ = host;
	physicalReleaseDispose = subscribeDocumentStartPhysicalHotkeyRelease(onPhysicalRelease);
	runtimeMessageListener = (message, sender, sendResponse) => {
		if (sender.id && sender.id !== chrome.runtime.id) return false;
		if (!isSpectraLeanSiteHotkeyConfigureMessage(message)) return false;
		applyConfiguration(
			message.payload.epoch,
			message.payload.generation,
			message.payload.bindings,
		);
		sendResponse({
			accepted: true,
			epoch: message.payload.epoch,
			generation: message.payload.generation,
		});
		return false;
	};
	chrome.runtime.onMessage.addListener(runtimeMessageListener);
	window.addEventListener('blur', onBlur);
	window.addEventListener('pagehide', onPageHide, { once: true });
	document.addEventListener('visibilitychange', onVisibilityChange);
}

export const leanSiteHotkeyHostTestApi = { controlRequest, MAX_PENDING_PULSES };
