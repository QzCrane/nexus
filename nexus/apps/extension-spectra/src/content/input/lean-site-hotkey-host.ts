// goal: website-first custom hotkeys without a document-lifetime heavy Content Runtime
// inv: content receives only a Background-adjudicated lean binding projection

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraLeanSiteHotkeyConfigureMessage,
	isSpectraRepeatableDefaultHotkeyAction,
	resolveSpectraDefaultHotkeyAction,
	type SpectraLeanSiteHotkeyBinding,
} from '@nexus/contracts/bootstrap';
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
}

const hostWindow = window as LeanSiteHotkeyWindow;
const activeByCode = new Map<string, ActiveBinding>();
let bindingByChord = new Map<string, SpectraLeanSiteHotkeyBinding>();
let arbiterDispose: (() => void) | null = null;
let physicalReleaseDispose: (() => void) | null = null;
let runtimeMessageListener: ((message: unknown, sender: chrome.runtime.MessageSender) => false) | null = null;
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

function sendTrigger(
	held: ActiveBinding,
	phase: 'press' | 'release',
	repeated: boolean,
): void {
	void chrome.runtime.sendMessage({
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.content.default-hotkey.trigger',
		payload: {
			action: held.binding.action,
			phase,
			gesture: held.gesture,
			repeated,
		},
	}).catch(() => undefined);
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
	for (const held of released) sendTrigger(held, 'release', held.repeated);
}

function releaseAll(): void {
	const released = [...activeByCode.values()];
	activeByCode.clear();
	for (const held of released) sendTrigger(held, 'release', held.repeated);
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
		};
		activeByCode.set(event.code, held);
		sendTrigger(held, 'press', false);
		return;
	}
	const held = activeByCode.get(event.code);
	if (!held) return;
	held.repeated = true;
	sendTrigger(held, 'press', true);
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

function isHotkeysChangedSignal(message: unknown): boolean {
	if (!message || typeof message !== 'object') return false;
	const candidate = message as { protocolVersion?: unknown; type?: unknown };
	return candidate.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& candidate.type === 'spectra.hotkeys.changed';
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
	runtimeMessageListener = (message, sender) => {
		if (sender.id && sender.id !== chrome.runtime.id) return false;
		// The broad settings event is only a fail-closed invalidation seam. The
		// host never parses the full settings payload; Background must follow with
		// a validated exact-document lean projection before input is re-enabled.
		if (isHotkeysChangedSignal(message)) {
			suspendConfiguration();
			return false;
		}
		if (!isSpectraLeanSiteHotkeyConfigureMessage(message)) return false;
		applyConfiguration(
			message.payload.epoch,
			message.payload.generation,
			message.payload.bindings,
		);
		return false;
	};
	chrome.runtime.onMessage.addListener(runtimeMessageListener);
	window.addEventListener('blur', onBlur);
	window.addEventListener('pagehide', onPageHide, { once: true });
	document.addEventListener('visibilitychange', onVisibilityChange);
}
