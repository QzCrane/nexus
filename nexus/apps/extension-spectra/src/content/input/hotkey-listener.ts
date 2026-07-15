// goal: intercepts keyboard events for site-specific custom hotkeys
// eff: zero-alloc hot path for keydown events

import type { HotkeySettings, HotkeyBinding, SiteHotkeyConfig } from '@nexus/contracts';
import {
	DEFAULT_HOTKEY_SETTINGS,
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
let lastHostname = '';

export async function initHotkeyListener(): Promise<() => void> {
	await loadSettings();
	const cleanup = createCleanupManager();

	cleanup.add(createEventListener(document, 'keydown', handleKeydown as EventListener, true));

	chrome.runtime.onMessage.addListener(handleSettingsEvent);
	cleanup.add(() => chrome.runtime.onMessage.removeListener(handleSettingsEvent));

	log.info('Hotkey listener initialized');
	return cleanup.dispose;
}

function handleSettingsEvent(message: unknown): false {
	if (isSpectraEventEnvelope(message) && message.type === 'spectra.hotkeys.changed') {
		settings = message.payload;
		cachedSite = undefined;
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
	return cachedSite;
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
	if (isInputElement(e.target)) return;

	const code = e.code;
	const ctrl = e.ctrlKey, alt = e.altKey, shift = e.shiftKey, meta = e.metaKey;

	for (const b of site.bindings) {
		if (!b.enabled || b.disabledReason) continue;
		const k = b.key;
		if (k.code === code &&
			k.modifiers.ctrl === ctrl &&
			k.modifiers.alt === alt &&
			k.modifiers.shift === shift &&
			k.modifiers.meta === meta) {

			e.preventDefault();
			e.stopPropagation();
			executeWithOSD(b);
			return;
		}
	}
}

function executeWithOSD(b: HotkeyBinding): void {
	const action = b.action;
	if (action !== 'none' && action !== 'open_popup' && action !== 'open_options' && action !== 'open_url' && action !== 'run_js') {
		showToast(formatLabel(action, b.params));
	}
	executeHotkeyAction(action, b.params);
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

export { setCaptureModeToggler, setConfigGetter, setConfigUpdater } from './hotkey-actions';
