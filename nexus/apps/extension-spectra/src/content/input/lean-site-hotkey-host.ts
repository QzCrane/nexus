// goal: website-first custom hotkeys without a document-lifetime heavy Content Runtime
// inv: content receives only a Background-adjudicated exact-document lean binding projection

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraLeanSiteHotkeyConfigureMessage,
	isSpectraRepeatableDefaultHotkeyAction,
	resolveSpectraDefaultHotkeyAction,
	type SpectraLeanSiteHotkeyBinding,
} from '@nexus/contracts/bootstrap';
import { runWithValidExtensionContext } from '../core/extension-context';
import {
	nextScalarGestureId,
	publishDefaultScalarGesture,
} from './default-scalar-gesture';
import {
	createWebsiteFirstKeyboardArbiter,
	isEditableHotkeyEvent,
	isTrustedHotkeyEvent,
	subscribeDocumentStartPhysicalHotkeyRelease,
} from './hotkey-event';
import { showToast } from '../ui/toast';

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
}

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

function triggerRequest(active: ActiveBinding, phase: 'press' | 'release', repeated: boolean): unknown {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.content.default-hotkey.trigger',
		payload: {
			action: active.binding.action,
			phase,
			gesture: active.gesture,
			repeated,
			disposition: 'site-page',
		},
	};
}

function responseError(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as { ok?: unknown; error?: unknown };
	if (candidate.ok !== false || !candidate.error || typeof candidate.error !== 'object') return null;
	const message = (candidate.error as { message?: unknown }).message;
	return typeof message === 'string' && message ? message : 'Site hotkey failed';
}

function sendPhase(active: ActiveBinding, phase: 'press' | 'release', repeated: boolean): Promise<void> {
	return runWithValidExtensionContext(
		() => chrome.runtime.sendMessage(triggerRequest(active, phase, repeated)),
		dispose,
	).then((response) => {
		if (phase !== 'press') return;
		const error = responseError(response);
		if (error) showToast(error, { shortcutGesture: active.gesture });
	});
}

function publishPhase(active: ActiveBinding, phase: 'press' | 'release' | 'settled'): void {
	publishDefaultScalarGesture({
		action: active.binding.action,
		gesture: active.gesture,
		phase,
		repeated: active.repeated,
	});
}

function pressBinding(active: ActiveBinding, repeated: boolean): void {
	if (repeated) active.repeated = true;
	if (active.binding.action === 'volume_mute' && repeated) return;
	publishPhase(active, 'press');
	void sendPhase(active, 'press', repeated).catch((error) => {
		if (!disposed) showToast(error instanceof Error ? error.message : String(error), {
			shortcutGesture: active.gesture,
		});
	});
}

function releaseHeld(active: ActiveBinding): void {
	publishPhase(active, 'release');
	void sendPhase(active, 'release', active.repeated)
		.catch(() => undefined)
		.finally(() => publishPhase(active, 'settled'));
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
		const active: ActiveBinding = {
			binding,
			gesture: nextScalarGestureId('site'),
			repeated: false,
		};
		activeByCode.set(event.code, active);
		pressBinding(active, false);
		return;
	}
	const active = activeByCode.get(event.code);
	if (active) pressBinding(active, true);
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
const onPageHide = (event: PageTransitionEvent): void => {
	releaseAll();
	// BFCache keeps this document and its isolated-world JS realm alive. Keep the
	// exact host/listeners installed so the restored page does not rely on stale
	// Background injection bookkeeping. A real navigation still retires it.
	if (!event.persisted) dispose();
};

function dispose(): void {
	if (disposed) return;
	disposed = true;
	// An invalid extension context cannot deliver a reliable release; clear local
	// ownership without recursively trying the already-invalid messaging path.
	activeByCode.clear();
	bindingByChord.clear();
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
	window.addEventListener('pagehide', onPageHide);
	document.addEventListener('visibilitychange', onVisibilityChange);
}

export const leanSiteHotkeyHostTestApi = { triggerRequest, responseError };
