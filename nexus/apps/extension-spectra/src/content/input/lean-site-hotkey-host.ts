// goal: website-first custom hotkeys without a document-lifetime heavy Content Runtime
// inv: only default-equivalent actions with canonical steps enter this host; every other site config stays on the full runtime

import {
	SPECTRA_PROTOCOL_VERSION,
	resolveSpectraDefaultHotkeyAction,
	type SpectraDefaultHotkeyAction,
} from '@nexus/contracts/bootstrap';
import {
	isHotkeySettings,
	type HotkeyBinding,
	type HotkeySettings,
} from '@nexus/contracts';
import {
	isLeanRepeatableSiteHotkeyAction,
	resolveSiteHotkeys,
} from '../../shared/site-hotkey-mode';
import {
	createWebsiteFirstKeyboardArbiter,
	isEditableHotkeyEvent,
	isTrustedHotkeyEvent,
	subscribeDocumentStartPhysicalHotkeyRelease,
} from './hotkey-event';

interface LeanSiteHotkeyHost {
	revision: 1;
	refresh(): Promise<void>;
	dispose(): void;
}

interface LeanSiteHotkeyWindow extends Window {
	__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: LeanSiteHotkeyHost;
}

interface ActiveBinding {
	binding: HotkeyBinding;
	gesture: string;
	repeated: boolean;
}

const hostWindow = window as LeanSiteHotkeyWindow;
const activeByCode = new Map<string, ActiveBinding>();
let bindingByChord = new Map<string, HotkeyBinding>();
let arbiterDispose: (() => void) | null = null;
let physicalReleaseDispose: (() => void) | null = null;
let runtimeMessageListener: ((message: unknown, sender: chrome.runtime.MessageSender) => false) | null = null;
let disposed = false;
let settingsEpoch = 0;

function chordKey(
	code: string,
	ctrl: boolean,
	alt: boolean,
	shift: boolean,
	meta: boolean,
): string {
	return `${code}:${ctrl ? 1 : 0}${alt ? 1 : 0}${shift ? 1 : 0}${meta ? 1 : 0}`;
}

function bindingChord(binding: HotkeyBinding): string {
	return chordKey(
		binding.key.code,
		binding.key.modifiers.ctrl,
		binding.key.modifiers.alt,
		binding.key.modifiers.shift,
		binding.key.modifiers.meta,
	);
}

function eventChord(event: KeyboardEvent): string {
	return chordKey(event.code, event.ctrlKey, event.altKey, event.shiftKey, event.metaKey);
}

function modifierForCode(code: string): keyof HotkeyBinding['key']['modifiers'] | null {
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
			action: held.binding.action as SpectraDefaultHotkeyAction,
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
			if (!held.binding.key.modifiers[modifier]) continue;
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

function resolveCandidate(event: KeyboardEvent): HotkeyBinding | null {
	if (!isTrustedHotkeyEvent(event)
		|| isBrowserRefreshShortcut(event)
		|| resolveSpectraDefaultHotkeyAction(event) !== null
		|| isEditableHotkeyEvent(event)) return null;

	if (event.repeat) {
		const active = activeByCode.get(event.code);
		if (!active || !isLeanRepeatableSiteHotkeyAction(active.binding.action)) return null;
		return bindingChord(active.binding) === eventChord(event) ? active.binding : null;
	}
	return bindingByChord.get(eventChord(event)) ?? null;
}

function onSettled(event: KeyboardEvent, binding: HotkeyBinding, websiteClaimed: boolean): void {
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

function applySettings(settings: HotkeySettings): void {
	releaseAll();
	const resolved = resolveSiteHotkeys(location.href, settings);
	const bindings = resolved?.mode === 'lean'
		? resolved.site.bindings.filter((binding) => binding.enabled && !binding.disabledReason)
		: [];
	bindingByChord = new Map(bindings.map((binding) => [bindingChord(binding), binding]));
	syncArbiter();
}

async function readSettings(): Promise<HotkeySettings | null> {
	const response = await chrome.runtime.sendMessage({
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.hotkeys.get',
		payload: {},
	}).catch(() => null) as { ok?: unknown; data?: unknown } | null;
	return response?.ok === true && isHotkeySettings(response.data) ? response.data : null;
}

async function refresh(): Promise<void> {
	const epoch = ++settingsEpoch;
	const settings = await readSettings();
	if (disposed || epoch !== settingsEpoch || !settings) return;
	applySettings(settings);
}

function dispose(): void {
	if (disposed) return;
	disposed = true;
	settingsEpoch += 1;
	releaseAll();
	bindingByChord.clear();
	arbiterDispose?.();
	arbiterDispose = null;
	physicalReleaseDispose?.();
	physicalReleaseDispose = null;
	if (runtimeMessageListener) chrome.runtime.onMessage.removeListener(runtimeMessageListener);
	runtimeMessageListener = null;
	if (hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__ === host) {
		delete hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
	}
}

const host: LeanSiteHotkeyHost = { revision: 1, refresh, dispose };
const existing = hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
if (existing?.revision === 1) {
	void existing.refresh();
} else {
	existing?.dispose();
	hostWindow.__SPECTRA_LEAN_SITE_HOTKEY_HOST__ = host;
	physicalReleaseDispose = subscribeDocumentStartPhysicalHotkeyRelease((event) => releaseCode(event.code));
	runtimeMessageListener = (message, sender) => {
		if (sender.id && sender.id !== chrome.runtime.id) return false;
		if (!message || typeof message !== 'object') return false;
		const candidate = message as {
			protocolVersion?: unknown;
			type?: unknown;
			payload?: unknown;
		};
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| candidate.type !== 'spectra.hotkeys.changed'
			|| !isHotkeySettings(candidate.payload)) return false;
		settingsEpoch += 1;
		applySettings(candidate.payload);
		return false;
	};
	chrome.runtime.onMessage.addListener(runtimeMessageListener);
	window.addEventListener('blur', releaseAll);
	window.addEventListener('pagehide', dispose, { once: true });
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) releaseAll();
	});
	void refresh();
}
