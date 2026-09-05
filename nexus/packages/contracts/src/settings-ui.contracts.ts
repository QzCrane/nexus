// goal: canonical, audio-free settings contracts and guards for Options/UI surfaces

import { normalizeHostname } from './domain.contracts.js';
import {
	HOTKEY_ACTIONS,
	isHotkeyParamsForAction,
	isSpectraDefaultHotkeyKeyCombo,
	isSlotHotkeyAction,
	type HotkeyAction,
	type HotkeyBinding,
	type HotkeyConditions,
	type HotkeySettings,
	type KeyCombo,
	type KeyModifiers,
	type SiteHotkeyConfig,
} from './hotkeys.contracts.js';

// Stable Settings v2 wire schema. Storage migrations have an independent
// version in the Background repository; adding site-route state must not mutate
// the strict spectra.settings.get/patch response under the same RPC version.
export const SPECTRA_SETTINGS_SCHEMA_VERSION = 2 as const;

export type ThemeMode = 'light' | 'dark' | 'system';

export type SupportedLanguage =
	| 'en-US'
	| 'zh-CN'
	| 'zh-TW'
	| 'ja-JP'
	| 'ko-KR'
	| 'es-ES'
	| 'ru-RU'
	| 'de-DE'
	| 'fr-FR';

export interface GlobalSettings {
	// osdEnabled: UI feedback overlay on volume/speed change
	osdEnabled: boolean;
	visualizerEnabled: boolean;
	lang: SupportedLanguage;
	themeMode: ThemeMode;
	// pauseRetentionSeconds: how long a paused tab stays in the UI list, 0=persistent
	pauseRetentionSeconds: number;
}

export const DEFAULT_GLOBAL_SETTINGS: Readonly<GlobalSettings> = {
	osdEnabled: true,
	visualizerEnabled: true,
	lang: 'en-US',
	themeMode: 'system',
	pauseRetentionSeconds: 60,
} as const;

export type HotkeySiteMutation =
	| { type: 'ensure-site'; enabled: boolean }
	| { type: 'delete-site' }
	| { type: 'set-enabled'; enabled: boolean }
	| { type: 'upsert-binding'; binding: HotkeyBinding }
	| { type: 'remove-binding'; bindingId: string };

export type SettingsUiPatch =
	| { scope: 'global'; changes: Partial<GlobalSettings> }
	| { scope: 'hotkey-slots'; changes: Record<string, HotkeyAction | null> }
	| { scope: 'hotkey-site-mutation'; domain: string; mutation: HotkeySiteMutation };

export interface SettingsUiPatchRequest {
	expectedRevision: number;
	patch: SettingsUiPatch;
}

export interface SettingsUiSnapshot {
	schemaVersion: typeof SPECTRA_SETTINGS_SCHEMA_VERSION;
	revision: number;
	globalSettings: GlobalSettings;
	hotkeySettings: HotkeySettings;
}

export function toSettingsUiSnapshot(
	snapshot: Pick<SettingsUiSnapshot, 'schemaVersion' | 'revision' | 'globalSettings' | 'hotkeySettings'>,
): SettingsUiSnapshot {
	return {
		schemaVersion: snapshot.schemaVersion,
		revision: snapshot.revision,
		globalSettings: snapshot.globalSettings,
		hotkeySettings: snapshot.hotkeySettings,
	};
}

const SUPPORTED_LANGUAGE_SET = new Set<SupportedLanguage>([
	'en-US',
	'zh-CN',
	'zh-TW',
	'ja-JP',
	'ko-KR',
	'es-ES',
	'ru-RU',
	'de-DE',
	'fr-FR',
]);
const THEME_MODE_SET = new Set<ThemeMode>(['light', 'dark', 'system']);
const HOTKEY_ACTION_SET = new Set<string>(HOTKEY_ACTIONS);
const GLOBAL_SETTINGS_KEYS = new Set<keyof GlobalSettings>([
	'osdEnabled',
	'visualizerEnabled',
	'lang',
	'themeMode',
	'pauseRetentionSeconds',
]);
const HOTKEY_SETTINGS_KEYS = new Set<keyof HotkeySettings>([
	'slots',
	'sites',
	'disabledLegacyBindings',
]);
const SITE_HOTKEY_KEYS = new Set<keyof SiteHotkeyConfig>(['enabled', 'bindings']);
const HOTKEY_BINDING_KEYS = new Set<keyof HotkeyBinding>([
	'id',
	'enabled',
	'key',
	'action',
	'params',
	'conditions',
	'disabledReason',
]);
const KEY_COMBO_KEYS = new Set<keyof KeyCombo>(['code', 'modifiers']);
const KEY_MODIFIER_KEYS = new Set<keyof KeyModifiers>(['ctrl', 'alt', 'shift', 'meta']);
const HOTKEY_CONDITION_KEYS = new Set<keyof HotkeyConditions>(['domains', 'requireMedia']);
const SETTINGS_UI_SNAPSHOT_KEYS = new Set<keyof SettingsUiSnapshot>([
	'schemaVersion',
	'revision',
	'globalSettings',
	'hotkeySettings',
]);
const SETTINGS_UI_PATCH_REQUEST_KEYS = new Set<keyof SettingsUiPatchRequest>([
	'expectedRevision',
	'patch',
]);
const GLOBAL_PATCH_KEYS = new Set(['scope', 'changes']);
const HOTKEY_SLOTS_PATCH_KEYS = new Set(['scope', 'changes']);
const HOTKEY_SITE_MUTATION_PATCH_KEYS = new Set(['scope', 'domain', 'mutation']);
const HOTKEY_SITE_ENSURE_MUTATION_KEYS = new Set(['type', 'enabled']);
const HOTKEY_SITE_DELETE_MUTATION_KEYS = new Set(['type']);
const HOTKEY_SITE_ENABLED_MUTATION_KEYS = new Set(['type', 'enabled']);
const HOTKEY_SITE_UPSERT_MUTATION_KEYS = new Set(['type', 'binding']);
const HOTKEY_SITE_REMOVE_MUTATION_KEYS = new Set(['type', 'bindingId']);
const MAX_PAUSE_RETENTION_SECONDS = 86_400;
const MAX_HOTKEY_BINDINGS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isKeyModifiers(value: unknown): value is KeyModifiers {
	if (!isRecord(value) || !hasOnlyKeys(value, KEY_MODIFIER_KEYS)) return false;
	return typeof value.ctrl === 'boolean'
		&& typeof value.alt === 'boolean'
		&& typeof value.shift === 'boolean'
		&& typeof value.meta === 'boolean';
}

function isKeyCombo(value: unknown): value is KeyCombo {
	if (!isRecord(value) || !hasOnlyKeys(value, KEY_COMBO_KEYS)) return false;
	return typeof value.code === 'string'
		&& value.code.length > 0
		&& value.code.length <= 64
		&& isKeyModifiers(value.modifiers);
}

function isHotkeyConditions(value: unknown): value is HotkeyConditions {
	if (!isRecord(value) || !hasOnlyKeys(value, HOTKEY_CONDITION_KEYS)) return false;
	if (value.requireMedia !== undefined && typeof value.requireMedia !== 'boolean') return false;
	return value.domains === undefined
		|| (Array.isArray(value.domains)
			&& value.domains.length <= 100
			&& value.domains.every((domain) => typeof domain === 'string' && normalizeHostname(domain) !== null));
}

function isHotkeyBindingShape(value: unknown): value is HotkeyBinding {
	if (!isRecord(value) || !hasOnlyKeys(value, HOTKEY_BINDING_KEYS)) return false;
	if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return false;
	if (typeof value.enabled !== 'boolean' || typeof value.action !== 'string' || !HOTKEY_ACTION_SET.has(value.action)) {
		return false;
	}
	const action = value.action as HotkeyAction;
	if (!isKeyCombo(value.key) || !isHotkeyParamsForAction(action, value.params)) return false;
	if (value.conditions !== undefined && !isHotkeyConditions(value.conditions)) return false;
	return value.disabledReason === undefined
		|| value.disabledReason === 'unsupported_action'
		|| value.disabledReason === 'reserved_default_chord';
}

// Persisted snapshots may retain an old site binding on a built-in chord only
// as explicit disabled migration evidence. A reserved reason on any other
// chord is stale and therefore not a valid projection.
function isHotkeyBinding(value: unknown): value is HotkeyBinding {
	if (!isHotkeyBindingShape(value)) return false;
	if (isSpectraDefaultHotkeyKeyCombo(value.key)) {
		return !value.enabled && value.disabledReason === 'reserved_default_chord';
	}
	return value.disabledReason !== 'reserved_default_chord';
}

function isUpsertHotkeyBinding(value: unknown): value is HotkeyBinding {
	return isHotkeyBindingShape(value)
		&& !isSpectraDefaultHotkeyKeyCombo(value.key)
		&& value.disabledReason !== 'reserved_default_chord';
}

function isHotkeyBindingId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isHotkeySiteMutation(value: unknown): value is HotkeySiteMutation {
	if (!isRecord(value)) return false;
	if (value.type === 'ensure-site') {
		return hasOnlyKeys(value, HOTKEY_SITE_ENSURE_MUTATION_KEYS)
			&& typeof value.enabled === 'boolean';
	}
	if (value.type === 'delete-site') {
		return hasOnlyKeys(value, HOTKEY_SITE_DELETE_MUTATION_KEYS);
	}
	if (value.type === 'set-enabled') {
		return hasOnlyKeys(value, HOTKEY_SITE_ENABLED_MUTATION_KEYS)
			&& typeof value.enabled === 'boolean';
	}
	if (value.type === 'upsert-binding') {
		return hasOnlyKeys(value, HOTKEY_SITE_UPSERT_MUTATION_KEYS)
			&& isUpsertHotkeyBinding(value.binding);
	}
	if (value.type === 'remove-binding') {
		return hasOnlyKeys(value, HOTKEY_SITE_REMOVE_MUTATION_KEYS)
			&& isHotkeyBindingId(value.bindingId);
	}
	return false;
}

function isSiteHotkeyConfig(value: unknown): value is SiteHotkeyConfig {
	if (!isRecord(value) || !hasOnlyKeys(value, SITE_HOTKEY_KEYS)) return false;
	return typeof value.enabled === 'boolean'
		&& Array.isArray(value.bindings)
		&& value.bindings.length <= MAX_HOTKEY_BINDINGS
		&& value.bindings.every(isHotkeyBinding);
}

export function isHotkeySettings(value: unknown): value is HotkeySettings {
	if (!isRecord(value) || !hasOnlyKeys(value, HOTKEY_SETTINGS_KEYS)) return false;
	if (!isRecord(value.slots) || Object.keys(value.slots).length > 128) return false;
	if (!Object.entries(value.slots).every(([slot, action]) => (
		slot.length > 0
		&& slot.length <= 128
		&& isSlotHotkeyAction(action)
	))) return false;
	if (!isRecord(value.sites) || Object.keys(value.sites).length > 1000) return false;
	if (!Object.entries(value.sites).every(([domain, site]) => (
		normalizeHostname(domain) === domain && isSiteHotkeyConfig(site)
	))) return false;
	return value.disabledLegacyBindings === undefined
		|| (Array.isArray(value.disabledLegacyBindings)
			&& value.disabledLegacyBindings.length <= MAX_HOTKEY_BINDINGS
			&& value.disabledLegacyBindings.every(isHotkeyBinding));
}

export function isGlobalSettings(value: unknown): value is GlobalSettings {
	if (!isRecord(value) || !hasOnlyKeys(value, GLOBAL_SETTINGS_KEYS)) return false;
	return typeof value.osdEnabled === 'boolean'
		&& typeof value.visualizerEnabled === 'boolean'
		&& typeof value.lang === 'string'
		&& SUPPORTED_LANGUAGE_SET.has(value.lang as SupportedLanguage)
		&& typeof value.themeMode === 'string'
		&& THEME_MODE_SET.has(value.themeMode as ThemeMode)
		&& isNonNegativeInteger(value.pauseRetentionSeconds)
		&& value.pauseRetentionSeconds <= MAX_PAUSE_RETENTION_SECONDS;
}

export function isSettingsUiSnapshot(value: unknown): value is SettingsUiSnapshot {
	if (!isRecord(value) || !hasOnlyKeys(value, SETTINGS_UI_SNAPSHOT_KEYS)) return false;
	return value.schemaVersion === SPECTRA_SETTINGS_SCHEMA_VERSION
		&& isNonNegativeInteger(value.revision)
		&& isGlobalSettings(value.globalSettings)
		&& isHotkeySettings(value.hotkeySettings);
}

function isGlobalPatch(value: Record<string, unknown>): boolean {
	if (!hasOnlyKeys(value, GLOBAL_PATCH_KEYS) || !isRecord(value.changes)) return false;
	return hasOnlyKeys(value.changes, GLOBAL_SETTINGS_KEYS)
		&& Object.entries(value.changes).every(([key, item]) => {
			if (key === 'osdEnabled' || key === 'visualizerEnabled') return typeof item === 'boolean';
			if (key === 'pauseRetentionSeconds') {
				return isNonNegativeInteger(item) && item <= MAX_PAUSE_RETENTION_SECONDS;
			}
			if (key === 'lang') return typeof item === 'string' && SUPPORTED_LANGUAGE_SET.has(item as SupportedLanguage);
			return typeof item === 'string' && THEME_MODE_SET.has(item as ThemeMode);
		});
}

function isHotkeySlotsPatch(value: Record<string, unknown>): boolean {
	if (!hasOnlyKeys(value, HOTKEY_SLOTS_PATCH_KEYS) || !isRecord(value.changes)) return false;
	return Object.keys(value.changes).length <= 128
		&& Object.entries(value.changes).every(([slot, action]) => (
			slot.length > 0
			&& slot.length <= 128
			&& (action === null || isSlotHotkeyAction(action))
		));
}

function isHotkeySiteMutationPatch(value: Record<string, unknown>): boolean {
	return hasOnlyKeys(value, HOTKEY_SITE_MUTATION_PATCH_KEYS)
		&& typeof value.domain === 'string'
		&& normalizeHostname(value.domain) !== null
		&& isHotkeySiteMutation(value.mutation);
}

export function isSettingsUiPatch(value: unknown): value is SettingsUiPatch {
	if (!isRecord(value)) return false;
	if (value.scope === 'global') return isGlobalPatch(value);
	if (value.scope === 'hotkey-slots') return isHotkeySlotsPatch(value);
	if (value.scope === 'hotkey-site-mutation') return isHotkeySiteMutationPatch(value);
	return false;
}

export function isSettingsUiPatchRequest(value: unknown): value is SettingsUiPatchRequest {
	return isRecord(value)
		&& hasOnlyKeys(value, SETTINGS_UI_PATCH_REQUEST_KEYS)
		&& isNonNegativeInteger(value.expectedRevision)
		&& isSettingsUiPatch(value.patch);
}
