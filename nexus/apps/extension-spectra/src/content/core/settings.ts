// goal: provides content runtime configuration projection
// note: bootstrap uses explicit request/response; hotkey settings are event-updated

import {
	DEFAULT_HOTKEY_SETTINGS,
	SPECTRA_PROTOCOL_VERSION,
	isSpectraEventEnvelope,
	isSpectraRpcResponse,
	type HotkeySettings,
	type GlobalSettings,
} from '@nexus/contracts';
import { sendSpectraRuntimeRequest } from '../../shared/spectra-client';
import { createRequestId } from '../../shared/ids';
import { invalidateRemoteSettingsCache } from './settings-cache';

let settings: GlobalSettings = {};
let hotkeySettings: HotkeySettings = structuredClone(DEFAULT_HOTKEY_SETTINGS);
let loaded = false;
let hotkeyLoaded = false;
let listenerInstalled = false;

interface LeanSiteHotkeyMarker {
	revision?: unknown;
	active?: unknown;
}

interface LeanSiteHotkeyWindow extends Window {
	__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: LeanSiteHotkeyMarker;
}

const NO_SITE_HOTKEY_SETTINGS: HotkeySettings = Object.freeze({
	slots: Object.freeze({}),
	sites: Object.freeze({}),
	disabledLegacyBindings: Object.freeze([]),
}) as HotkeySettings;

function leanSiteHotkeyOwnsConfiguredBindings(): boolean {
	const marker = (window as LeanSiteHotkeyWindow).__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
	return marker?.revision === 2 && marker.active === true;
}

function installListener(): void {
	if (listenerInstalled) return;
	listenerInstalled = true;
	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (isSpectraEventEnvelope(message) && message.type === 'spectra.content.settings.changed') {
			settings = message.payload;
			loaded = true;
			invalidateRemoteSettingsCache();
			return false;
		}
		if (isSpectraEventEnvelope(message) && message.type === 'spectra.hotkeys.changed') {
			hotkeySettings = message.payload;
			hotkeyLoaded = true;
			return false;
		}
		return false;
	});
}

export async function loadSettings(): Promise<GlobalSettings> {
	if (loaded) return settings;
	installListener();
	try {
		const response = await sendSpectraRuntimeRequest('spectra.content.settings.get', {});
		if (isSpectraRpcResponse(response)
			&& response.ok
			&& response.data
			&& typeof response.data === 'object') {
			settings = response.data as GlobalSettings;
			loaded = true;
		}
	} catch (error) {
		console.warn('[SPECTRA] Failed to load settings:', error);
	}
	return settings;
}

export function updateContentSettings(next: GlobalSettings): void {
	settings = next;
	loaded = true;
	invalidateRemoteSettingsCache();
}

export async function loadHotkeySettings(): Promise<HotkeySettings> {
	if (hotkeyLoaded) return hotkeySettings;
	installListener();
	try {
		const response = await chrome.runtime.sendMessage({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: createRequestId(),
			type: 'spectra.hotkeys.get',
			payload: {},
		});
		if (isSpectraRpcResponse(response) && response.ok) {
			hotkeySettings = response.data as HotkeySettings;
			hotkeyLoaded = true;
		}
	} catch (error) {
		console.warn('[SPECTRA] Failed to load hotkeys:', error);
	}
	return getActiveHotkeySettings();
}

export function updateContentHotkeySettings(next: HotkeySettings): void {
	hotkeySettings = next;
	hotkeyLoaded = true;
}

export function getSettings(): GlobalSettings {
	return settings;
}

export function getActiveHotkeySettings(): HotkeySettings {
	// The lean exact host is the physical configured-site owner. Heavy runtime may
	// exist transiently for control/feedback or for unrelated leases; while lean
	// owns bindings, project no configured sites so its listener cannot attach or
	// claim repeats in the READY→exact-suspend delivery window.
	return leanSiteHotkeyOwnsConfiguredBindings()
		? NO_SITE_HOTKEY_SETTINGS
		: hotkeySettings;
}

// rule: resets cached content-side settings between lifecycles/tests
export function resetSettings(): void {
	settings = {};
	hotkeySettings = structuredClone(DEFAULT_HOTKEY_SETTINGS);
	loaded = false;
	hotkeyLoaded = false;
}

installListener();

export const contentSettingsTestApi = {
	leanSiteHotkeyOwnsConfiguredBindings,
};
