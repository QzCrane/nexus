// goal: defines contracts for persistent settings and the storage abstraction layer

import { normalizeHostname } from './domain.contracts.js';
import { isAudioConfig, isAudioConfigPatch, type AudioConfig } from './audio.contracts.js';
import {
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	isGlobalSettings,
	isHotkeySettings,
	isSettingsUiPatch,
	type GlobalSettings,
	type SettingsUiPatch,
} from './settings-ui.contracts.js';
import type { HotkeySettings } from './hotkeys.contracts.js';
import {
	isMediaProcessingRoute,
	type MediaProcessingRoute,
} from './media-route.contracts.js';

export {
	DEFAULT_GLOBAL_SETTINGS,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	isGlobalSettings,
	isHotkeySettings,
	isSettingsUiPatch,
} from './settings-ui.contracts.js';
export type {
	GlobalSettings,
	HotkeySiteMutation,
	SupportedLanguage,
	ThemeMode,
} from './settings-ui.contracts.js';

/**
 * Maximum number of audio site and global-preset entries in one settings
 * snapshot. The same bound applies to each collection and their combined
 * wire projection so individually valid mutations cannot create an
 * untransmittable snapshot.
 */
export const MAX_SETTINGS_SNAPSHOT_ENTRIES = 10_000 as const;

export interface SettingsSnapshot {
	schemaVersion: typeof SPECTRA_SETTINGS_SCHEMA_VERSION;
	revision: number;
	globalSettings: GlobalSettings;
	hotkeySettings: HotkeySettings;
	audioSites: Record<string, Partial<AudioConfig>>;
	audioPresets: Record<string, AudioPresetValue>;
	defaultPresetId: string | null;
}

export interface AudioSitePolicy {
	config: AudioConfig;
	mediaRoute: MediaProcessingRoute | 'auto';
}

export interface AudioPresetMeta {
	type: 'global';
	name: string;
	createdAt: number;
	isDefault?: boolean;
}

export interface AudioPresetValue {
	config: Partial<AudioConfig>;
	meta: AudioPresetMeta;
}

export type SettingsPatch = SettingsUiPatch
	| {
		scope: 'audio-site';
		domain: string;
		value: Partial<AudioConfig> | null;
		mode?: 'merge' | 'replace';
	}
	| { scope: 'audio-preset'; name: string; value: AudioPresetValue | null }
	| { scope: 'default-preset'; value: string | null }
	| { scope: 'audio-presets-clear' };

export interface SettingsPatchRequest {
	expectedRevision: number;
	patch: SettingsPatch;
}

const SETTINGS_SNAPSHOT_KEYS = new Set<keyof SettingsSnapshot>([
	'schemaVersion',
	'revision',
	'globalSettings',
	'hotkeySettings',
	'audioSites',
	'audioPresets',
	'defaultPresetId',
]);
const SETTINGS_PATCH_REQUEST_KEYS = new Set<keyof SettingsPatchRequest>(['expectedRevision', 'patch']);
const AUDIO_SITE_PATCH_KEYS = new Set(['scope', 'domain', 'value', 'mode']);
const AUDIO_PRESET_PATCH_KEYS = new Set(['scope', 'name', 'value']);
const DEFAULT_PRESET_PATCH_KEYS = new Set(['scope', 'value']);
const AUDIO_PRESETS_CLEAR_PATCH_KEYS = new Set(['scope']);
const AUDIO_PRESET_VALUE_KEYS = new Set<keyof AudioPresetValue>(['config', 'meta']);
const AUDIO_PRESET_META_KEYS = new Set<keyof AudioPresetMeta>(['type', 'name', 'createdAt', 'isDefault']);
const AUDIO_SITE_POLICY_KEYS = new Set<keyof AudioSitePolicy>(['config', 'mediaRoute']);
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPresetName(value: unknown): value is string {
	return typeof value === 'string'
		&& value.trim().length > 0
		&& value.length <= 128
		&& [...value].every((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 31 && codePoint !== 127;
		})
		&& value !== '__proto__'
		&& value !== 'constructor'
		&& value !== 'prototype';
}

function isAudioPresetValue(value: unknown, name: string): value is AudioPresetValue {
	if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_PRESET_VALUE_KEYS) || !isAudioConfigPatch(value.config)) {
		return false;
	}
	const meta = value.meta;
	if (!isRecord(meta) || !hasOnlyKeys(meta, AUDIO_PRESET_META_KEYS)) return false;
	return meta.type === 'global'
		&& meta.name === name
		&& isPresetName(meta.name)
		&& typeof meta.createdAt === 'number'
		&& Number.isSafeInteger(meta.createdAt)
		&& meta.createdAt >= 0
		&& (meta.isDefault === undefined || typeof meta.isDefault === 'boolean');
}

function isAudioSites(value: unknown): value is Record<string, Partial<AudioConfig>> {
	if (!isRecord(value) || Object.keys(value).length > MAX_SETTINGS_SNAPSHOT_ENTRIES) return false;
	return Object.entries(value).every(([domain, config]) => (
		normalizeHostname(domain) === domain && isAudioConfigPatch(config)
	));
}

function isAudioPresets(value: unknown): value is Record<string, AudioPresetValue> {
	if (!isRecord(value) || Object.keys(value).length > MAX_SETTINGS_SNAPSHOT_ENTRIES) return false;
	return Object.entries(value).every(([name, preset]) => (
		isPresetName(name) && isAudioPresetValue(preset, name)
	));
}

export function isAudioSitePolicy(value: unknown): value is AudioSitePolicy {
	return isRecord(value)
		&& hasOnlyKeys(value, AUDIO_SITE_POLICY_KEYS)
		&& isAudioConfig(value.config)
		&& (value.mediaRoute === 'auto' || isMediaProcessingRoute(value.mediaRoute));
}

// post: validates the full revisioned snapshot returned by the background repository
export function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
	if (!isRecord(value) || !hasOnlyKeys(value, SETTINGS_SNAPSHOT_KEYS)) return false;
	return value.schemaVersion === SPECTRA_SETTINGS_SCHEMA_VERSION
		&& isNonNegativeInteger(value.revision)
		&& isGlobalSettings(value.globalSettings)
		&& isHotkeySettings(value.hotkeySettings)
		&& isAudioSites(value.audioSites)
		&& isAudioPresets(value.audioPresets)
		&& Object.keys(value.audioSites).length + Object.keys(value.audioPresets).length
			<= MAX_SETTINGS_SNAPSHOT_ENTRIES
		&& (value.defaultPresetId === null || (
			typeof value.defaultPresetId === 'string'
			&& Object.hasOwn(value.audioPresets, value.defaultPresetId)
		));
}

// post: rejects malformed or over-broad field patches before repository mutation
export function isSettingsPatchRequest(value: unknown): value is SettingsPatchRequest {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, SETTINGS_PATCH_REQUEST_KEYS)
		|| !isNonNegativeInteger(value.expectedRevision)
		|| !isRecord(value.patch)) return false;
	const patch = value.patch;
	if (isSettingsUiPatch(patch)) return true;
	if (patch.scope === 'audio-site') {
		return hasOnlyKeys(patch, AUDIO_SITE_PATCH_KEYS)
			&& typeof patch.domain === 'string'
			&& normalizeHostname(patch.domain) !== null
			&& (patch.mode === undefined || patch.mode === 'merge' || patch.mode === 'replace')
			&& (patch.value === null || isAudioConfigPatch(patch.value));
	}
	if (patch.scope === 'audio-preset') {
		return hasOnlyKeys(patch, AUDIO_PRESET_PATCH_KEYS)
			&& isPresetName(patch.name)
			&& (patch.value === null || isAudioPresetValue(patch.value, patch.name));
	}
	if (patch.scope === 'default-preset') {
		return hasOnlyKeys(patch, DEFAULT_PRESET_PATCH_KEYS)
		&& (patch.value === null || isPresetName(patch.value));
	}
	if (patch.scope === 'audio-presets-clear') {
		return hasOnlyKeys(patch, AUDIO_PRESETS_CLEAR_PATCH_KEYS);
	}
	return false;
}
