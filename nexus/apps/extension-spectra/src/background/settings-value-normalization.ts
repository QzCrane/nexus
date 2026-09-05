// goal: pure settings normalization and canonical value projections

import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_HOTKEY_SETTINGS,
	clampControlValue,
	compileEffectiveVolume,
	HOTKEY_ACTIONS,
	isFiniteControlValue,
	isAudioConfigPatch,
	isHotkeyParamsForAction,
	isSlotHotkeyAction,
	isSpectraDefaultHotkeyKeyCombo,
	normalizeHostname,
	resolveAudioVolume,
	selectHotkeyAvailability,
	splitEffectiveVolume,
	type AudioConfig,
	type GlobalSettings,
	type HotkeyAction,
	type HotkeyBinding,
	type HotkeySettings,
	type SiteHotkeyConfig,
} from '@nexus/contracts';

export const MAX_PAUSE_RETENTION_SECONDS = 86_400;

const UNSUPPORTED_ACTIONS = new Set<HotkeyAction>(
	HOTKEY_ACTIONS.filter((action) => selectHotkeyAvailability(action) === 'disabled-legacy'),
);
const HOTKEY_ACTION_SET = new Set<string>(HOTKEY_ACTIONS);
const SUPPORTED_LANGUAGES = new Set<GlobalSettings['lang']>([
	'en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'ru-RU', 'de-DE', 'fr-FR',
]);
const THEME_MODES = new Set<GlobalSettings['themeMode']>(['light', 'dark', 'system']);

export function isSupportedLanguage(value: unknown): value is GlobalSettings['lang'] {
	return typeof value === 'string' && SUPPORTED_LANGUAGES.has(value as GlobalSettings['lang']);
}

export function isSupportedThemeMode(value: unknown): value is GlobalSettings['themeMode'] {
	return typeof value === 'string' && THEME_MODES.has(value as GlobalSettings['themeMode']);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneDefaultHotkeys(): HotkeySettings {
	return {
		slots: { ...DEFAULT_HOTKEY_SETTINGS.slots },
		sites: {},
		disabledLegacyBindings: [],
	};
}

export function normalizeGlobalSettings(raw: unknown, preferLegacyAliases: boolean): GlobalSettings {
	const source = isRecord(raw) ? raw : {};
	const legacyLanguage = source.language;
	const langCandidate = preferLegacyAliases && typeof legacyLanguage === 'string'
		? legacyLanguage
		: source.lang;
	const themeCandidate = source.themeMode ?? source.theme;
	const pause = typeof source.pauseRetentionSeconds === 'number' && Number.isFinite(source.pauseRetentionSeconds)
		? Math.round(source.pauseRetentionSeconds)
		: DEFAULT_GLOBAL_SETTINGS.pauseRetentionSeconds;

	return {
		osdEnabled: typeof source.osdEnabled === 'boolean' ? source.osdEnabled : DEFAULT_GLOBAL_SETTINGS.osdEnabled,
		visualizerEnabled: typeof source.visualizerEnabled === 'boolean'
			? source.visualizerEnabled
			: DEFAULT_GLOBAL_SETTINGS.visualizerEnabled,
		lang: isSupportedLanguage(langCandidate)
			? langCandidate
			: DEFAULT_GLOBAL_SETTINGS.lang,
		themeMode: isSupportedThemeMode(themeCandidate)
			? themeCandidate
			: DEFAULT_GLOBAL_SETTINGS.themeMode,
		pauseRetentionSeconds: Math.max(0, Math.min(MAX_PAUSE_RETENTION_SECONDS, pause)),
	};
}

export function sanitizeBinding(value: unknown): HotkeyBinding | null {
	if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return null;
	if (typeof value.enabled !== 'boolean' || typeof value.action !== 'string' || !HOTKEY_ACTION_SET.has(value.action)) return null;
	if (!isRecord(value.key) || typeof value.key.code !== 'string' || !isRecord(value.key.modifiers)) return null;
	const modifiers = value.key.modifiers;
	if (typeof modifiers.ctrl !== 'boolean' || typeof modifiers.alt !== 'boolean'
		|| typeof modifiers.shift !== 'boolean' || typeof modifiers.meta !== 'boolean') return null;

	const binding: HotkeyBinding = {
		id: value.id,
		enabled: value.enabled,
		key: {
			code: value.key.code.slice(0, 64),
			modifiers: {
				ctrl: modifiers.ctrl,
				alt: modifiers.alt,
				shift: modifiers.shift,
				meta: modifiers.meta,
			},
		},
		action: value.action as HotkeyAction,
	};
	if (!isHotkeyParamsForAction(binding.action, value.params)) return null;
	if (value.params) binding.params = { ...value.params };
	if (isRecord(value.conditions)) binding.conditions = { ...value.conditions };
	if (value.disabledReason === 'unsupported_action'
		|| value.disabledReason === 'reserved_default_chord') {
		binding.disabledReason = value.disabledReason;
	}
	return binding;
}

export function upsertDisabledLegacyBinding(
	disabledLegacy: HotkeyBinding[],
	binding: HotkeyBinding,
): 'inserted' | 'updated' | 'unchanged' {
	const candidate = structuredClone(binding);
	const index = disabledLegacy.findIndex(({ id }) => id === candidate.id);
	if (index < 0) {
		disabledLegacy.push(candidate);
		return 'inserted';
	}
	if (JSON.stringify(disabledLegacy[index]) === JSON.stringify(candidate)) return 'unchanged';
	disabledLegacy[index] = candidate;
	return 'updated';
}

export function canonicalizeBindingDisability(binding: HotkeyBinding): {
	reason: HotkeyBinding['disabledReason'];
	changed: boolean;
} {
	const previousEnabled = binding.enabled;
	const previousReason = binding.disabledReason;
	if (isSpectraDefaultHotkeyKeyCombo(binding.key)) {
		binding.enabled = false;
		binding.disabledReason = 'reserved_default_chord';
		return {
			reason: binding.disabledReason,
			changed: previousEnabled !== binding.enabled || previousReason !== binding.disabledReason,
		};
	}
	if (UNSUPPORTED_ACTIONS.has(binding.action) || binding.disabledReason === 'unsupported_action') {
		binding.enabled = false;
		binding.disabledReason = 'unsupported_action';
		return {
			reason: binding.disabledReason,
			changed: previousEnabled !== binding.enabled || previousReason !== binding.disabledReason,
		};
	}
	if (binding.disabledReason === 'reserved_default_chord') delete binding.disabledReason;
	return {
		reason: undefined,
		changed: previousReason !== binding.disabledReason,
	};
}

export function sanitizeSite(
	value: unknown,
	disabledLegacy: HotkeyBinding[],
	onRepair?: () => void,
): SiteHotkeyConfig {
	const source = isRecord(value) ? value : {};
	const bindings = Array.isArray(source.bindings)
		? source.bindings.map(sanitizeBinding).filter((binding): binding is HotkeyBinding => !!binding)
		: [];
	for (const binding of bindings) {
		const result = canonicalizeBindingDisability(binding);
		if (!result.reason) {
			if (result.changed) onRepair?.();
			continue;
		}
		const legacyResult = upsertDisabledLegacyBinding(disabledLegacy, binding);
		if (result.changed || legacyResult !== 'unchanged') {
			onRepair?.();
		}
	}
	return { enabled: source.enabled === true, bindings };
}

export function mergeHotkeySites(left: SiteHotkeyConfig | undefined, right: SiteHotkeyConfig): SiteHotkeyConfig {
	if (!left) return right;
	const bindings = new Map(left.bindings.map((binding) => [binding.id, binding]));
	for (const binding of right.bindings) bindings.set(binding.id, binding);
	return {
		enabled: left.enabled || right.enabled,
		bindings: [...bindings.values()],
	};
}

export function normalizeHotkeySettings(raw: unknown): {
	settings: HotkeySettings;
	requiresPersistence: boolean;
} {
	const source = isRecord(raw) ? raw : {};
	const normalized = cloneDefaultHotkeys();
	let requiresPersistence = false;
	if (isRecord(source.slots)) {
		for (const [command, action] of Object.entries(source.slots)) {
			if (isSlotHotkeyAction(action)) normalized.slots[command] = action;
		}
	}

	const disabledLegacy: HotkeyBinding[] = [];
	if (Array.isArray(source.disabledLegacyBindings)) {
		for (const candidate of source.disabledLegacyBindings) {
			const binding = sanitizeBinding(candidate);
			if (!binding) continue;
			const result = canonicalizeBindingDisability(binding);
			if (!result.reason) {
				if (result.changed) requiresPersistence = true;
				continue;
			}
			const duplicate = disabledLegacy.some(({ id }) => id === binding.id);
			const legacyResult = upsertDisabledLegacyBinding(disabledLegacy, binding);
			if (duplicate || result.changed || legacyResult === 'updated') {
				requiresPersistence = true;
			}
		}
	}
	if (isRecord(source.sites)) {
		for (const [rawDomain, site] of Object.entries(source.sites)) {
			const domain = normalizeHostname(rawDomain);
			if (!domain) continue;
			normalized.sites[domain] = mergeHotkeySites(
				normalized.sites[domain],
				sanitizeSite(site, disabledLegacy, () => {
					requiresPersistence = true;
				}),
			);
		}
	}
	normalized.disabledLegacyBindings = disabledLegacy;
	return { settings: normalized, requiresPersistence };
}

export function normalizeSiteSettings(raw: unknown): Record<string, unknown> | null {
	if (!isRecord(raw)) return null;
	const normalized: Record<string, unknown> = {};
	for (const [rawDomain, value] of Object.entries(raw)) {
		const domain = normalizeHostname(rawDomain) ?? rawDomain;
		if (!isRecord(value)) {
			normalized[domain] = value;
			continue;
		}
		const delay = typeof value.delay === 'number' && Number.isFinite(value.delay)
			? clampControlValue(value.delay, 'delay', 0)
			: value.delay;
		normalized[domain] = {
			...(isRecord(normalized[domain]) ? normalized[domain] : {}),
			...value,
			...(delay === undefined ? {} : { delay }),
		};
	}
	return normalized;
}

function comparePresetNames(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export type PresetRecord = Record<string, unknown> & {
	config: Record<string, unknown>;
	meta: Record<string, unknown>;
};

export function isPresetRecord(value: unknown): value is PresetRecord {
	return isRecord(value) && isRecord(value.config) && isRecord(value.meta);
}

export function choosePresetFallback(globalPresets: Record<string, unknown>): string | null {
	return Object.keys(globalPresets)
		.filter((name) => isPresetRecord(globalPresets[name]))
		.sort(comparePresetNames)[0] ?? null;
}

export function hasLegacyDefaultFlag(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.isDefault === true) return true;
	return isRecord(value.meta) && value.meta.isDefault === true;
}

export function syncDefaultPresetFlags(globalPresets: Record<string, unknown>, defaultPresetId: string | null): void {
	for (const [name, entry] of Object.entries(globalPresets)) {
		if (!isPresetRecord(entry)) continue;
		globalPresets[name] = {
			...entry,
			meta: { ...entry.meta, isDefault: name === defaultPresetId },
		};
	}
}

export function normalizePresetState(
	rawPresets: unknown,
	rawDefaultPresetId: unknown,
	hasCanonicalDefault: boolean,
): { globalPresets: Record<string, unknown>; defaultPresetId: string | null } {
	const source = isRecord(rawPresets) ? rawPresets : {};
	const globalPresets: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(source)) {
		if (!isRecord(value)) {
			globalPresets[name] = value;
			continue;
		}
		// Earliest preset builds stored a bare config without the meta wrapper.
		// Wrap that shape here so migration persists the canonical record instead
		// of re-wrapping on every read. Opaque unknown records stay untouched so a
		// future schema can pass through this migration unchanged.
		const bareCandidate = isRecord(value.config) ? value.config : value;
		const canonical = isPresetRecord(value)
			? value
			: isAudioConfigPatch(bareCandidate)
				? {
					config: bareCandidate,
					meta: { type: 'global' as const, name, createdAt: 0 },
				}
				: value;
		const config = isRecord(canonical.config) ? canonical.config : null;
		const delay = typeof config?.delay === 'number' && Number.isFinite(config.delay)
			? clampControlValue(config.delay, 'delay', 0)
			: config?.delay;
		globalPresets[name] = {
			...canonical,
			...(config ? { config: { ...config, ...(delay === undefined ? {} : { delay }) } } : {}),
			...(isRecord(canonical.meta) ? { meta: { ...canonical.meta } } : {}),
		};
	}

	let defaultPresetId: string | null = null;
	if (hasCanonicalDefault) {
		if (rawDefaultPresetId === null) {
			defaultPresetId = null;
		} else if (typeof rawDefaultPresetId === 'string' && isPresetRecord(globalPresets[rawDefaultPresetId])) {
			defaultPresetId = rawDefaultPresetId;
		} else {
			defaultPresetId = Object.keys(globalPresets)
				.filter((name) => isPresetRecord(globalPresets[name]) && hasLegacyDefaultFlag(globalPresets[name]))
				.sort(comparePresetNames)[0] ?? null;
		}
	} else {
		defaultPresetId = Object.keys(globalPresets)
			.filter((name) => isPresetRecord(globalPresets[name]) && hasLegacyDefaultFlag(globalPresets[name]))
			.sort(comparePresetNames)[0] ?? null;
	}
	syncDefaultPresetFlags(globalPresets, defaultPresetId);
	return { globalPresets, defaultPresetId };
}

export function mergeCanonicalAudioConfig(
	existing: Record<string, unknown>,
	changes: Partial<AudioConfig>,
	mode: 'merge' | 'replace',
): Record<string, unknown> {
	const hasCoupledChanges = changes.volume !== undefined
		|| changes.volumeBase !== undefined
		|| changes.boost !== undefined;
	const base = mode === 'replace'
		? { ...DEFAULT_AUDIO_CONFIG }
		: hasCoupledChanges ? canonicalizeExistingAudioConfig(existing) : { ...existing };
	const combined = { ...base, ...changes };
	if (!hasCoupledChanges) return combined;
	const resolved = changes.volumeBase !== undefined || changes.boost !== undefined
		? resolveAudioVolume({
			volumeBase: Number(combined.volumeBase ?? DEFAULT_AUDIO_CONFIG.volumeBase),
			boost: Number(combined.boost ?? DEFAULT_AUDIO_CONFIG.boost),
		})
		: changes.volume !== undefined
			? splitEffectiveVolume(changes.volume)
			: resolveAudioVolume({
				volumeBase: Number(combined.volumeBase ?? DEFAULT_AUDIO_CONFIG.volumeBase),
				boost: Number(combined.boost ?? DEFAULT_AUDIO_CONFIG.boost),
			});
	return {
		...combined,
		volume: compileEffectiveVolume(resolved.volumeBase, resolved.boost),
		volumeBase: resolved.volumeBase,
		boost: resolved.boost,
	};
}

export function canonicalizeExistingAudioConfig(existing: Record<string, unknown>): Record<string, unknown> {
	const volume = isFiniteControlValue(existing.volume, 'volume') ? existing.volume : undefined;
	const volumeBase = isFiniteControlValue(existing.volumeBase, 'volumeBase')
		? existing.volumeBase
		: undefined;
	const boost = isFiniteControlValue(existing.boost, 'boost') ? existing.boost : undefined;
	const resolved = volumeBase !== undefined && boost !== undefined
		? resolveAudioVolume({ volumeBase, boost })
		: volume !== undefined
			? (() => {
				const split = splitEffectiveVolume(volume);
				return resolveAudioVolume(split);
			})()
			: resolveAudioVolume({
				volumeBase: volumeBase ?? DEFAULT_AUDIO_CONFIG.volumeBase,
				boost: boost ?? DEFAULT_AUDIO_CONFIG.boost,
			});
	return {
		...existing,
		volume: resolved.effectiveVolume,
		volumeBase: resolved.volumeBase,
		boost: resolved.boost,
	};
}

export function snapshotAudioPatch(value: unknown): Partial<AudioConfig> {
	if (!isRecord(value)) return {};
	const patch: Partial<AudioConfig> = {};
	for (const key of ['enabled', 'muted', 'compressor', 'mono', 'bass', 'preservePitch'] as const) {
		if (typeof value[key] === 'boolean') patch[key] = value[key];
	}
	if (isFiniteControlValue(value.volume, 'volume')) patch.volume = value.volume;
	if (isFiniteControlValue(value.volumeBase, 'volumeBase')) patch.volumeBase = value.volumeBase;
	if (isFiniteControlValue(value.boost, 'boost')) patch.boost = value.boost;
	if (patch.volumeBase === undefined && patch.boost === undefined && patch.volume !== undefined) {
		const migrated = splitEffectiveVolume(patch.volume);
		patch.volumeBase = migrated.volumeBase;
		patch.boost = migrated.boost;
	} else if (patch.volumeBase !== undefined || patch.boost !== undefined) {
		const canonical = resolveAudioVolume({
			volumeBase: patch.volumeBase ?? DEFAULT_AUDIO_CONFIG.volumeBase,
			boost: patch.boost ?? DEFAULT_AUDIO_CONFIG.boost,
		});
		patch.volumeBase = canonical.volumeBase;
		patch.boost = canonical.boost;
		patch.volume = canonical.effectiveVolume;
	}
	if (isFiniteControlValue(value.pan, 'pan')) patch.pan = value.pan;
	if (typeof value.delay === 'number' && Number.isFinite(value.delay)) {
		patch.delay = clampControlValue(value.delay, 'delay', 0);
	}
	if (isFiniteControlValue(value.speed, 'speed')) patch.speed = value.speed;
	if (Array.isArray(value.eqValues)
		&& value.eqValues.length === 10
		&& value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))) {
		patch.eqValues = [...value.eqValues];
	}
	return patch;
}

export function isSnapshotPresetName(name: string): boolean {
	return name.trim().length > 0
		&& name.length <= 128
		&& name !== '__proto__'
		&& name !== 'constructor'
		&& name !== 'prototype'
		&& [...name].every((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 31 && codePoint !== 127;
		});
}
