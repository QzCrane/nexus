// goal: intercepts keyboard events for site-specific custom hotkeys
// eff: zero-alloc hot path for keydown events

import type { HotkeySettings, HotkeyBinding, SiteHotkeyConfig } from '@nexus/contracts';
import {
	DEFAULT_HOTKEY_SETTINGS,
	HOTKEY_ACTION_DESCRIPTORS,
	findBestHostnameMatch,
	isSpectraEventEnvelope,
	normalizeHostname,
} from '@nexus/contracts';
import { createLogger } from '../../shared/logger';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { createEventListener, createCleanupManager } from '../utils/timing';
import { executeHotkeyAction } from './hotkey-actions';
import { isTrustedHotkeyEvent } from './hotkey-event';
import { showToast } from '../ui/toast';

const log = createLogger('Hotkeys');

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };
let cachedSite: SiteHotkeyConfig | null | undefined;
let cachedBindings: Map<string, HotkeyBinding> | undefined;
let lastHostname = '';
const lastExecution = new Map<string, number>();
const coalesced = new Map<string, ReturnType<typeof setTimeout>>();
let keydownDisposer: (() => void) | null = null;
let keyupDisposer: (() => void) | null = null;

function synchronizeKeydownListener(): void {
	const shouldListen = getSiteConfig() !== null;
	if (shouldListen && !keydownDisposer) {
		keydownDisposer = createEventListener(document, 'keydown', handleKeydown as EventListener, true);
		keyupDisposer = createEventListener(document, 'keyup', handleKeyup as EventListener, true);
	} else if (!shouldListen && keydownDisposer) {
		keydownDisposer();
		keydownDisposer = null;
		if (keyupDisposer) {
			keyupDisposer();
			keyupDisposer = null;
		}
	}
}

export async function initHotkeyListener(): Promise<() => void> {
	await loadSettings();
	const cleanup = createCleanupManager();

	synchronizeKeydownListener();

	chrome.runtime.onMessage.addListener(handleSettingsEvent);
	cleanup.add(() => chrome.runtime.onMessage.removeListener(handleSettingsEvent));
	cleanup.add(() => {
		keydownDisposer?.();
		keydownDisposer = null;
		if (keyupDisposer) {
			keyupDisposer();
			keyupDisposer = null;
		}
		for (const timer of coalesced.values()) clearTimeout(timer);
		coalesced.clear();
		lastExecution.clear();
	});

	log.info('Hotkey listener initialized');
	return cleanup.dispose;
}

function handleSettingsEvent(message: unknown): false {
	if (isSpectraEventEnvelope(message) && message.type === 'spectra.hotkeys.changed') {
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
	} catch { }
}

function getSiteConfig(): SiteHotkeyConfig | null {
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

const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isInputElement(t: EventTarget | null): boolean {
	if (!t || !(t instanceof HTMLElement)) return false;
	if (t.isContentEditable) return true;
	return IGNORE_TAGS.has(t.tagName);
}

function handleKeydown(e: KeyboardEvent): void {
	if (!isTrustedHotkeyEvent(e)) return;
	const site = getSiteConfig();
	if (!site) return;
	if (e.composedPath().some((target) => isInputElement(target))) return;

	const binding = getBindingMap(site).get(bindingKey(
		e.code,
		e.ctrlKey,
		e.altKey,
		e.shiftKey,
		e.metaKey,
	));
	if (!binding) return;
	const descriptor = HOTKEY_ACTION_DESCRIPTORS[binding.action];
	if (e.repeat && descriptor.repeatPolicy !== 'coalesce-20hz') return;
	e.preventDefault();
	e.stopPropagation();
	if (descriptor.repeatPolicy !== 'coalesce-20hz' || !e.repeat) {
		lastExecution.set(binding.id, performance.now());
		void executeWithOSD(binding);
		return;
	}
	if (coalesced.has(binding.id)) return;
	const wait = Math.max(0, 50 - (performance.now() - (lastExecution.get(binding.id) ?? 0)));
	coalesced.set(binding.id, setTimeout(() => {
		coalesced.delete(binding.id);
		lastExecution.set(binding.id, performance.now());
		void executeWithOSD(binding);
	}, wait));
}

function handleKeyup(e: KeyboardEvent): void {
	if (!isTrustedHotkeyEvent(e)) return;
	const site = getSiteConfig();
	if (!site) return;

	const binding = getBindingMap(site).get(bindingKey(
		e.code,
		e.ctrlKey,
		e.altKey,
		e.shiftKey,
		e.metaKey,
	));
	if (!binding) return;

	// 立即清除待执行的定时器，防止松手后继续执行
	const timer = coalesced.get(binding.id);
	if (timer) {
		clearTimeout(timer);
		coalesced.delete(binding.id);
	}
}

async function executeWithOSD(b: HotkeyBinding): Promise<void> {
	const action = b.action;
	try {
		await executeHotkeyAction(action, b.params);
		if (HOTKEY_ACTION_DESCRIPTORS[action].feedbackOwner === 'listener-label') {
			showToast(formatLabel(action, b.params));
		}
	} catch (error) {
		log.warn(`Hotkey ${action} failed`, error);
		showToast(error instanceof Error ? error.message : String(error));
	}
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
