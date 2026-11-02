// goal: the only writer for SPECTRA global and hotkey settings

import {
	DEFAULT_AUDIO_CONFIG,
	compileEffectiveVolume,
	isSpectraDefaultHotkeyKeyCombo,
	isSlotHotkeyAction,
	MAX_SETTINGS_SNAPSHOT_ENTRIES,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	MAX_PAUSE_RETENTION_SECONDS,
	createSiteRouteFingerprint,
	createMediaRouteRuleFingerprint,
	createMediaRouteScopeKey,
	findBestHostnameMatch,
	isMediaRouteSettings,
	isAudioConfigPatch,
	isFiniteControlValue,
	normalizeHostname,
	normalizeMediaRouteScope,
	parseMediaRouteScopeKey,
	selectMediaProcessingRoute,
	selectMediaRouteDecisionForUrl,
	type GlobalSettings,
	type AudioConfig,
	type AudioPresetValue,
	type HotkeyBinding,
	type HotkeySettings,
	type HotkeySiteMutation,
	type SettingsPatch,
	type SettingsSnapshot,
	type MediaRouteSettings,
	type MediaProcessingRoute,
	type MediaRouteDecision,
	type MediaRouteRulesSnapshot,
	type MediaRouteScope,
	type DomainSource,
	type RegistryAddResult,
	type RegistryQueryResult,
	type RegistryRemoveResult,
	type RegistrySnapshot,
	type SiteHotkeyConfig,
} from '@nexus/contracts';
import {
	choosePresetFallback,
	isPresetRecord,
	isRecord,
	isSnapshotPresetName,
	isSupportedLanguage,
	isSupportedThemeMode,
	mergeCanonicalAudioConfig,
	normalizeGlobalSettings,
	normalizeHotkeySettings,
	normalizePresetState,
	normalizeSiteSettings,
	sanitizeSite,
	snapshotAudioPatch,
	syncDefaultPresetFlags,
} from './settings-value-normalization';
import {
	LEGACY_MEDIA_ROUTE_KEYS,
	MEDIA_ROUTES_KEY,
	normalizeMediaRoutes,
	projectMediaRouteEntry,
	projectMediaRouteRulesSnapshot,
	projectMediaRouteSnapshot,
	selectMediaRouteStorageValue,
} from './media-route-projection';
import {
	InvalidSettingsPatchError,
	SettingsCapacityError,
	SettingsRevisionConflictError,
} from './settings-errors';

const GLOBAL_KEY = 'globalSettings';
const HOTKEY_KEY = 'hotkeySettings';
const SITE_SETTINGS_KEY = 'siteSettings';
const GLOBAL_PRESETS_KEY = 'globalPresets';
const DEFAULT_PRESET_KEY = 'defaultPresetId';
const PAGE_SCALES_KEY = 'siteVolumeScales';
const META_KEY = 'spectraSettingsMeta';
const SETTINGS_STORAGE_SCHEMA_VERSION = 3 as const;
const MAX_SITE_HOTKEY_BINDINGS = 1000;
// note: must include EVERY field sanitizeAudioPatch handles below. Missing `preservePitch`
// here caused `audio-site` replace-mode saves to throw `Unknown audio setting: preservePitch`
// because state.config (a full AudioConfig) always carries preservePitch.
const AUDIO_CONFIG_KEYS = new Set<keyof AudioConfig>([
	'enabled', 'volume', 'volumeBase', 'boost', 'muted', 'compressor', 'mono', 'bass', 'eqValues', 'pan', 'delay', 'speed', 'preservePitch',
]);

interface SettingsMeta {
	schemaVersion: typeof SETTINGS_STORAGE_SCHEMA_VERSION;
	revision: number;
	migratedAt: number;
}

export interface SettingsStorageArea {
	get(keys: string | string[]): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove?(keys: string | string[]): Promise<void>;
}

function requireSite(
	sites: HotkeySettings['sites'],
	domain: string,
): SiteHotkeyConfig {
	const site = sites[domain];
	if (!site) throw new InvalidSettingsPatchError('Hotkey site does not exist');
	return site;
}

function applyHotkeySiteMutation(
	current: HotkeySettings,
	domain: string,
	mutation: HotkeySiteMutation,
): HotkeySettings {
	const sites = { ...current.sites };
	let disabledLegacyBindings = [...(current.disabledLegacyBindings ?? [])];

	switch (mutation.type) {
		case 'ensure-site':
			if (!sites[domain]) sites[domain] = { enabled: mutation.enabled, bindings: [] };
			break;
		case 'delete-site':
			delete sites[domain];
			break;
		case 'set-enabled': {
			const site = requireSite(sites, domain);
			sites[domain] = { ...site, enabled: mutation.enabled };
			break;
		}
		case 'upsert-binding': {
			const site = requireSite(sites, domain);
			if (isSpectraDefaultHotkeyKeyCombo(mutation.binding.key)) {
				throw new InvalidSettingsPatchError(
					'Built-in SPECTRA shortcut chords cannot be assigned to site hotkeys',
				);
			}
			disabledLegacyBindings = disabledLegacyBindings.filter(({ id }) => id !== mutation.binding.id);
			const sanitized = sanitizeSite(
				{ enabled: site.enabled, bindings: [mutation.binding] },
				disabledLegacyBindings,
			).bindings[0];
			if (!sanitized) throw new InvalidSettingsPatchError('Invalid hotkey binding');

			const bindings: HotkeyBinding[] = [];
			let replaced = false;
			for (const binding of site.bindings) {
				if (binding.id !== sanitized.id) {
					bindings.push(binding);
				} else if (!replaced) {
					bindings.push(sanitized);
					replaced = true;
				}
			}
			if (!replaced) {
				if (bindings.length >= MAX_SITE_HOTKEY_BINDINGS) {
					throw new InvalidSettingsPatchError('Hotkey site binding limit reached');
				}
				bindings.push(sanitized);
			}
			sites[domain] = { ...site, bindings };
			break;
		}
		case 'remove-binding': {
			const site = requireSite(sites, domain);
			sites[domain] = {
				...site,
				bindings: site.bindings.filter(({ id }) => id !== mutation.bindingId),
			};
			disabledLegacyBindings = disabledLegacyBindings.filter(({ id }) => id !== mutation.bindingId);
			break;
		}
	}

	return { ...current, sites, disabledLegacyBindings };
}

function sanitizeAudioPatch(value: Partial<AudioConfig>): Partial<AudioConfig> {
	const patch: Partial<AudioConfig> = {};
	for (const key of Object.keys(value)) {
		if (!AUDIO_CONFIG_KEYS.has(key as keyof AudioConfig)) {
			throw new InvalidSettingsPatchError(`Unknown audio setting: ${key}`);
		}
	}
	for (const key of ['enabled', 'muted', 'compressor', 'mono', 'bass'] as const) {
		if (value[key] !== undefined) {
			if (typeof value[key] !== 'boolean') throw new InvalidSettingsPatchError(`${key} must be boolean`);
			patch[key] = value[key];
		}
	}
	if (value.volume !== undefined) {
		if (!isFiniteControlValue(value.volume, 'volume')) {
			throw new InvalidSettingsPatchError('volume must be between 0 and 800');
		}
		patch.volume = value.volume;
	}
	if (value.volumeBase !== undefined) {
		if (!isFiniteControlValue(value.volumeBase, 'volumeBase')) {
			throw new InvalidSettingsPatchError('volumeBase must be between 0 and 100');
		}
		patch.volumeBase = value.volumeBase;
	}
	if (value.boost !== undefined) {
		if (!isFiniteControlValue(value.boost, 'boost')) {
			throw new InvalidSettingsPatchError('boost must be between 1 and 8');
		}
		patch.boost = value.boost;
	}
	if (value.volume !== undefined && (value.volumeBase !== undefined || value.boost !== undefined)) {
		if (value.volumeBase === undefined
			|| value.boost === undefined
			|| value.volume !== compileEffectiveVolume(value.volumeBase, value.boost)) {
			throw new InvalidSettingsPatchError(
				'volume must equal the volumeBase and boost product when all coupled fields are supplied',
			);
		}
	}
	if (value.pan !== undefined) {
		if (!isFiniteControlValue(value.pan, 'pan')) {
			throw new InvalidSettingsPatchError('pan must be between -1 and 1');
		}
		patch.pan = value.pan;
	}
	if (value.delay !== undefined) {
		if (!isFiniteControlValue(value.delay, 'delay')) {
			throw new InvalidSettingsPatchError('delay must be between 0 and 500');
		}
		patch.delay = value.delay;
	}
	if (value.speed !== undefined) {
		if (!isFiniteControlValue(value.speed, 'speed')) {
			throw new InvalidSettingsPatchError('speed must be between 0.1 and 16');
		}
		patch.speed = value.speed;
	}
	if (value.preservePitch !== undefined) {
		if (typeof value.preservePitch !== 'boolean') {
			throw new InvalidSettingsPatchError('preservePitch must be a boolean');
		}
		patch.preservePitch = value.preservePitch;
	}
	if (value.eqValues !== undefined) {
		if (value.eqValues.length !== 10 || value.eqValues.some((item) => !isFiniteControlValue(item, 'eqBand'))) {
			throw new InvalidSettingsPatchError('eqValues must contain ten values between -12 and 12');
		}
		patch.eqValues = [...value.eqValues];
	}
	return patch;
}

function createSettingsSnapshot(
	revision: number,
	globalSettings: GlobalSettings,
	hotkeySettings: HotkeySettings,
	rawSites: unknown,
	rawPresets: unknown,
	rawDefaultPresetId: unknown,
): SettingsSnapshot {
	const audioSites: SettingsSnapshot['audioSites'] = {};
	if (isRecord(rawSites)) {
		for (const [rawDomain, value] of Object.entries(rawSites)) {
			const domain = normalizeHostname(rawDomain);
			if (domain && isRecord(value)) audioSites[domain] = snapshotAudioPatch(value);
		}
	}

	const audioPresets: Record<string, AudioPresetValue> = {};
	if (isRecord(rawPresets)) {
		for (const [name, value] of Object.entries(rawPresets)) {
			if (!isSnapshotPresetName(name)) continue;
			// Earliest preset builds stored a bare config without the meta wrapper.
			// Wrap that audio-shaped record instead of silently dropping the user's
			// saved preset; opaque unknown shapes stay excluded from the snapshot.
			let entry: unknown = value;
			if (isRecord(entry) && !isPresetRecord(entry)) {
				const bareCandidate = isRecord(entry.config) ? entry.config : entry;
				if (!isAudioConfigPatch(bareCandidate)) continue;
				entry = {
					config: bareCandidate,
					meta: { type: 'global', name, createdAt: 0 },
				};
			}
			if (!isPresetRecord(entry)) continue;
			const createdAt = typeof entry.meta.createdAt === 'number'
				&& Number.isSafeInteger(entry.meta.createdAt)
				&& entry.meta.createdAt >= 0
				? entry.meta.createdAt
				: 0;
			audioPresets[name] = {
				config: snapshotAudioPatch(entry.config),
				meta: {
					type: 'global',
					name,
					createdAt,
					isDefault: rawDefaultPresetId === name,
				},
			};
		}
	}
	const defaultPresetId = typeof rawDefaultPresetId === 'string'
		&& Object.hasOwn(audioPresets, rawDefaultPresetId)
		? rawDefaultPresetId
		: null;
	const audioSiteCount = Object.keys(audioSites).length;
	const audioPresetCount = Object.keys(audioPresets).length;
	if (audioSiteCount + audioPresetCount > MAX_SETTINGS_SNAPSHOT_ENTRIES) {
		throw new SettingsCapacityError(audioSiteCount, audioPresetCount);
	}

	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision,
		globalSettings,
		hotkeySettings,
		audioSites,
		audioPresets,
		defaultPresetId,
	};
}

function parseMeta(raw: unknown): SettingsMeta | null {
	if (!isRecord(raw)
		|| (raw.schemaVersion !== SETTINGS_STORAGE_SCHEMA_VERSION
			&& raw.schemaVersion !== SPECTRA_SETTINGS_SCHEMA_VERSION)
		|| typeof raw.revision !== 'number'
		|| !Number.isInteger(raw.revision)
		|| raw.revision < 0) return null;
	return {
		schemaVersion: SETTINGS_STORAGE_SCHEMA_VERSION,
		revision: raw.revision,
		migratedAt: typeof raw.migratedAt === 'number' ? raw.migratedAt : Date.now(),
	};
}

export class SettingsRepository {
	private operationQueue: Promise<void> = Promise.resolve();

	constructor(private readonly storageArea?: SettingsStorageArea) {}

	private get local(): SettingsStorageArea {
		return this.storageArea ?? chrome.storage.local;
	}

	initialize(): Promise<SettingsSnapshot> {
		return this.serialized(() => this.readState());
	}

	getSnapshot(): Promise<SettingsSnapshot> {
		return this.serialized(() => this.readState());
	}

	resolveAudioConfig(hostname: string): Promise<AudioConfig> {
		return this.serialized(async () => {
			const snapshot = await this.readState();
			const match = findBestHostnameMatch(
				hostname,
				Object.entries(snapshot.audioSites),
				([domain]) => domain,
			);
		// fallback: when no site-specific config matches, apply the user's
		// chosen default global preset so new sites inherit that baseline
		// instead of the silent DEFAULT_AUDIO_CONFIG. Site entries still win
		// because they are the explicit per-domain authority.
		let patch = match?.[1];
		if (!patch && snapshot.defaultPresetId) {
			const presetEntry = snapshot.audioPresets[snapshot.defaultPresetId];
			if (presetEntry?.config) patch = presetEntry.config;
		}
		// If no explicit default preset is marked, still honor a global preset
		// as the baseline for every site that has no per-site rule. A user who
		// configured a global preset but never flagged one as "default" should
		// still see it applied to every site without its own preset.
		if (!patch) {
			const fallbackName = choosePresetFallback(snapshot.audioPresets);
			if (fallbackName) {
				const presetEntry = snapshot.audioPresets[fallbackName];
				if (presetEntry?.config) patch = presetEntry.config;
			}
		}
			return {
				...DEFAULT_AUDIO_CONFIG,
				...patch,
				eqValues: patch?.eqValues
					? [...patch.eqValues]
					: [...DEFAULT_AUDIO_CONFIG.eqValues],
			};
		});
	}

	resolveMediaRoute(hostname: string): Promise<MediaProcessingRoute | 'auto'> {
		return this.serialized(async () => {
			await this.readState();
			return selectMediaProcessingRoute(hostname, await this.readMediaRoutes());
		});
	}

	resolveMediaRouteDecision(hostname: string): Promise<MediaRouteDecision> {
		return this.serialized(async () => {
			await this.readState();
			const normalized = normalizeHostname(hostname);
			if (!normalized) return { mediaRoute: 'auto', source: null };
			const candidates = Object.entries(await this.readMediaRoutes()).filter(([key]) => (
				!parseMediaRouteScopeKey(key)?.pathPrefix
			));
			const match = findBestHostnameMatch(
				normalized,
				candidates.filter(([, entry]) => entry.source === 'user'),
				([domain]) => domain,
			) ?? findBestHostnameMatch(normalized, candidates, ([domain]) => domain);
			return match
				? { mediaRoute: match[1].route, source: match[1].source }
				: { mediaRoute: 'auto', source: null };
		});
	}

	resolveMediaRouteDecisionForUrl(resourceUrl: string): Promise<MediaRouteDecision> {
		return this.serialized(async () => {
			await this.readState();
			return selectMediaRouteDecisionForUrl(resourceUrl, await this.readMediaRoutes());
		});
	}

	getMediaRouteSnapshot(): Promise<RegistrySnapshot> {
		return this.serialized(async () => {
			await this.readState();
			return projectMediaRouteSnapshot(await this.readMediaRoutes());
		});
	}

	getMediaRouteSettings(): Promise<MediaRouteSettings> {
		return this.serialized(async () => {
			await this.readState();
			return { ...await this.readMediaRoutes() };
		});
	}

	getMediaRouteRulesSnapshot(): Promise<MediaRouteRulesSnapshot> {
		return this.serialized(async () => {
			await this.readState();
			return projectMediaRouteRulesSnapshot(await this.readMediaRoutes());
		});
	}

	queryMediaRoute(domain: string): Promise<RegistryQueryResult> {
		return this.serialized(async () => {
			await this.readState();
			const normalized = normalizeHostname(domain);
			if (!normalized) throw new InvalidSettingsPatchError('Invalid media route hostname');
			const routes = await this.readMediaRoutes();
			const candidates = Object.entries(routes).filter(([key]) => (
				!parseMediaRouteScopeKey(key)?.pathPrefix
			));
			const match = findBestHostnameMatch(
				normalized,
				candidates.filter(([, entry]) => entry.source === 'user'),
				([candidate]) => candidate,
			) ?? findBestHostnameMatch(normalized, candidates, ([candidate]) => candidate);
			return { entry: match ? projectMediaRouteEntry(match[0], match[1]) : null };
		});
	}

	addMediaRoute(
		domain: string,
		source: DomainSource,
		route: MediaProcessingRoute,
		options: { force?: boolean } = {},
	): Promise<RegistryAddResult> {
		return this.serialized(async () => {
			const current = await this.readState();
			const normalized = normalizeHostname(domain);
			if (!normalized) throw new InvalidSettingsPatchError('Invalid media route hostname');
			const routes = await this.readMediaRoutes();
			const existing = routes[normalized];
			const created = existing === undefined;
			if (!(source === 'auto' && existing?.source === 'user' && !options.force)) {
				routes[normalized] = { route, source, updatedAt: Date.now() };
				await this.persistMediaRoutes(routes, current.revision + 1);
			}
			const snapshot = projectMediaRouteSnapshot(routes);
			const entry = snapshot.entries.find((candidate) => candidate.domain === normalized);
			if (!entry) throw new Error('Media route mutation did not produce a canonical entry');
			return { ...snapshot, entry, created };
		});
	}

	markMediaRouteProbed(
		domain: string,
		route: MediaProcessingRoute,
		options: { force?: boolean } = {},
	): Promise<RegistryAddResult> {
		return this.addMediaRoute(domain, 'auto', route, options);
	}

	upsertMediaRouteRule(
		scope: MediaRouteScope,
		route: MediaProcessingRoute,
	): Promise<MediaRouteRulesSnapshot> {
		return this.serialized(async () => {
			const current = await this.readState();
			const normalized = normalizeMediaRouteScope(scope.domain, scope.pathPrefix);
			const key = normalized ? createMediaRouteScopeKey(normalized) : null;
			if (!key) throw new InvalidSettingsPatchError('Invalid media route scope');
			const routes = await this.readMediaRoutes();
			routes[key] = { route, source: 'user', updatedAt: Date.now() };
			await this.persistMediaRoutes(routes, current.revision + 1);
			return projectMediaRouteRulesSnapshot(routes);
		});
	}

	removeMediaRouteRule(fingerprint: string): Promise<MediaRouteRulesSnapshot> {
		return this.serialized(async () => {
			const current = await this.readState();
			const routes = await this.readMediaRoutes();
			const key = Object.keys(routes).find((candidate) => {
				const scope = parseMediaRouteScopeKey(candidate);
				return scope && createMediaRouteRuleFingerprint(scope) === fingerprint;
			});
			if (!key) return projectMediaRouteRulesSnapshot(routes);
			delete routes[key];
			await this.persistMediaRoutes(routes, current.revision + 1);
			return projectMediaRouteRulesSnapshot(routes);
		});
	}

	removeMediaRoute(fingerprint: string): Promise<RegistryRemoveResult> {
		return this.serialized(async () => {
			const current = await this.readState();
			const routes = await this.readMediaRoutes();
			const domain = Object.keys(routes).find((candidate) => (
				createSiteRouteFingerprint(candidate) === fingerprint
			));
			if (!domain) return { ...projectMediaRouteSnapshot(routes), removed: false };
			delete routes[domain];
			await this.persistMediaRoutes(routes, current.revision + 1);
			return { ...projectMediaRouteSnapshot(routes), removed: true };
		});
	}

	clearPageNativeScale(hostname: string): Promise<void> {
		return this.serialized(async () => {
			const normalized = normalizeHostname(hostname);
			if (!normalized) throw new InvalidSettingsPatchError('Invalid page-scale hostname');
			const scales = await this.readPageScales();
			if (!Object.hasOwn(scales, normalized)) return;
			delete scales[normalized];
			await this.persistPageScales(scales);
		});
	}

	getPageNativeScale(hostname: string): Promise<boolean | null> {
		return this.serialized(async () => {
			const normalized = normalizeHostname(hostname);
			if (!normalized) return null;
			const scales = await this.readPageScales();
			return scales[normalized]?.supported ?? null;
		});
	}

	recordPageNativeScale(hostname: string, supported: boolean): Promise<void> {
		return this.serialized(async () => {
			const normalized = normalizeHostname(hostname);
			if (!normalized) throw new InvalidSettingsPatchError('Invalid page-scale hostname');
			const scales = await this.readPageScales();
			const existing = scales[normalized];
			if (existing?.supported === supported) return;
			scales[normalized] = { supported, updatedAt: Date.now() };
			await this.persistPageScales(scales);
		});
	}

	private async readPageScales(): Promise<Record<string, { supported: boolean; updatedAt: number }>> {
		const result = await this.readValues([PAGE_SCALES_KEY]);
		const scales: Record<string, { supported: boolean; updatedAt: number }> = {};
		if (isRecord(result[PAGE_SCALES_KEY])) {
			for (const [domain, value] of Object.entries(result[PAGE_SCALES_KEY])) {
				const hostname = normalizeHostname(domain);
				if (!hostname || !isRecord(value) || typeof value.supported !== 'boolean') continue;
				scales[hostname] = {
					supported: value.supported,
					updatedAt: typeof value.updatedAt === 'number' && Number.isSafeInteger(value.updatedAt)
						? value.updatedAt
						: 0,
				};
			}
		}
		return scales;
	}

	private async persistPageScales(
		scales: Record<string, { supported: boolean; updatedAt: number }>,
	): Promise<void> {
		if (Object.keys(scales).length > MAX_SETTINGS_SNAPSHOT_ENTRIES) {
			throw new SettingsCapacityError(0, 0, Object.keys(scales).length);
		}
		// Advisory detection metadata, not a user setting: persisting it must not
		// invalidate UI patches that carry an expected settings revision.
		await this.local.set({ [PAGE_SCALES_KEY]: scales });
	}

	flush(): Promise<void> {
		return this.serialized(async () => undefined);
	}

	applyPatch(patch: SettingsPatch, expectedRevision?: number): Promise<SettingsSnapshot> {
		return this.serialized(async () => {
			const current = await this.readState();
			if (expectedRevision !== undefined && expectedRevision !== current.revision) {
				throw new SettingsRevisionConflictError(current.revision);
			}
			const result = await this.readValues([
				GLOBAL_KEY,
				HOTKEY_KEY,
				SITE_SETTINGS_KEY,
				GLOBAL_PRESETS_KEY,
				DEFAULT_PRESET_KEY,
				MEDIA_ROUTES_KEY,
				META_KEY,
			]);
			const rawGlobal = isRecord(result[GLOBAL_KEY]) ? result[GLOBAL_KEY] : {};
			const rawHotkeys = isRecord(result[HOTKEY_KEY]) ? result[HOTKEY_KEY] : {};
			const siteSettings = isRecord(result[SITE_SETTINGS_KEY]) ? { ...result[SITE_SETTINGS_KEY] } : {};
			const presetState = normalizePresetState(
				result[GLOBAL_PRESETS_KEY],
				result[DEFAULT_PRESET_KEY],
				Object.hasOwn(result, DEFAULT_PRESET_KEY),
			);
			const globalPresets = presetState.globalPresets;
			const mediaRoutes = normalizeMediaRoutes(result[MEDIA_ROUTES_KEY]);
			let defaultPresetId = presetState.defaultPresetId;
			let globalSettings = current.globalSettings;
			let hotkeySettings = current.hotkeySettings;

			switch (patch.scope) {
				case 'global':
					globalSettings = this.applyGlobalPatch(globalSettings, patch.changes);
					break;
				case 'hotkey-slots': {
					const slots = { ...hotkeySettings.slots };
					for (const [command, action] of Object.entries(patch.changes)) {
						if (!command || command.length > 128) throw new InvalidSettingsPatchError('Invalid shortcut slot');
						if (action === null) delete slots[command];
						else if (isSlotHotkeyAction(action)) slots[command] = action;
						else throw new InvalidSettingsPatchError(`Unsupported hotkey action: ${action}`);
					}
					hotkeySettings = { ...hotkeySettings, slots };
					break;
				}
				case 'hotkey-site-mutation': {
					const domain = normalizeHostname(patch.domain);
					if (!domain) throw new InvalidSettingsPatchError('Invalid site hostname');
					hotkeySettings = applyHotkeySiteMutation(hotkeySettings, domain, patch.mutation);
					break;
				}
				case 'audio-site': {
					const domain = normalizeHostname(patch.domain);
					if (!domain) throw new InvalidSettingsPatchError('Invalid audio settings hostname');
					if (patch.value === null) {
						delete siteSettings[domain];
						break;
					}
					const changes = sanitizeAudioPatch(patch.value);
					const existing = isRecord(siteSettings[domain]) ? siteSettings[domain] : {};
					if (patch.mode === 'replace') {
						const unknown = Object.fromEntries(
							Object.entries(existing).filter(([key]) => !AUDIO_CONFIG_KEYS.has(key as keyof AudioConfig)),
						);
						siteSettings[domain] = { ...unknown, ...mergeCanonicalAudioConfig({}, changes, 'replace') };
					} else {
						siteSettings[domain] = mergeCanonicalAudioConfig(existing, changes, 'merge');
					}
					break;
				}
				case 'audio-preset': {
					if (patch.value === null) {
						delete globalPresets[patch.name];
						if (defaultPresetId === patch.name) defaultPresetId = choosePresetFallback(globalPresets);
						break;
					}
					const rawExisting = globalPresets[patch.name];
					const existing: Record<string, unknown> = isRecord(rawExisting) ? rawExisting : {};
					const existingConfig = isRecord(existing.config) ? existing.config : {};
					const existingMeta = isRecord(existing.meta) ? existing.meta : {};
					const configChanges = sanitizeAudioPatch(patch.value.config);
					globalPresets[patch.name] = {
						...existing,
						...patch.value,
						config: mergeCanonicalAudioConfig(existingConfig, configChanges, 'merge'),
						meta: { ...existingMeta, ...patch.value.meta, isDefault: defaultPresetId === patch.name },
					};
					break;
				}
				case 'default-preset': {
					if (patch.value !== null && !isPresetRecord(globalPresets[patch.value])) {
						throw new InvalidSettingsPatchError('Default preset does not exist');
					}
					defaultPresetId = patch.value;
					for (const [name, entry] of Object.entries(globalPresets)) {
						if (!isRecord(entry)) continue;
						const meta = isRecord(entry.meta) ? entry.meta : {};
						globalPresets[name] = { ...entry, meta: { ...meta, isDefault: name === defaultPresetId } };
					}
					break;
				}
				case 'audio-presets-clear': {
					for (const domain of Object.keys(siteSettings)) delete siteSettings[domain];
					for (const name of Object.keys(globalPresets)) delete globalPresets[name];
					defaultPresetId = null;
					break;
				}
				default:
					throw new InvalidSettingsPatchError('Unknown settings patch scope');
			}
			syncDefaultPresetFlags(globalPresets, defaultPresetId);

			const revision = current.revision + 1;
			const previousMeta = parseMeta(result[META_KEY]);
			const meta: SettingsMeta = {
				schemaVersion: SETTINGS_STORAGE_SCHEMA_VERSION,
				revision,
				migratedAt: previousMeta?.migratedAt ?? Date.now(),
			};
			const nextSnapshot = createSettingsSnapshot(
				revision,
				globalSettings,
				hotkeySettings,
				siteSettings,
				globalPresets,
				defaultPresetId,
			);
			await this.local.set({
				[GLOBAL_KEY]: { ...rawGlobal, ...globalSettings },
				[HOTKEY_KEY]: { ...rawHotkeys, ...hotkeySettings },
				[SITE_SETTINGS_KEY]: siteSettings,
				[GLOBAL_PRESETS_KEY]: globalPresets,
				[DEFAULT_PRESET_KEY]: defaultPresetId,
				[MEDIA_ROUTES_KEY]: mediaRoutes,
				[META_KEY]: meta,
			});
			return nextSnapshot;
		});
	}

	private applyGlobalPatch(current: GlobalSettings, changes: Partial<GlobalSettings>): GlobalSettings {
		const next = { ...current };
		if (changes.osdEnabled !== undefined) {
			if (typeof changes.osdEnabled !== 'boolean') throw new InvalidSettingsPatchError('osdEnabled must be boolean');
			next.osdEnabled = changes.osdEnabled;
		}
		if (changes.visualizerEnabled !== undefined) {
			if (typeof changes.visualizerEnabled !== 'boolean') throw new InvalidSettingsPatchError('visualizerEnabled must be boolean');
			next.visualizerEnabled = changes.visualizerEnabled;
		}
		if (changes.lang !== undefined) {
			if (!isSupportedLanguage(changes.lang)) throw new InvalidSettingsPatchError('Unsupported language');
			next.lang = changes.lang;
		}
		if (changes.themeMode !== undefined) {
			if (!isSupportedThemeMode(changes.themeMode)) throw new InvalidSettingsPatchError('Unsupported theme mode');
			next.themeMode = changes.themeMode;
		}
		if (changes.pauseRetentionSeconds !== undefined) {
			if (!Number.isInteger(changes.pauseRetentionSeconds) || changes.pauseRetentionSeconds < 0) {
				throw new InvalidSettingsPatchError('pauseRetentionSeconds must be a non-negative integer');
			}
			next.pauseRetentionSeconds = Math.min(MAX_PAUSE_RETENTION_SECONDS, changes.pauseRetentionSeconds);
		}
		return next;
	}

	private async readState(): Promise<SettingsSnapshot> {
		const result = await this.readValues([
			GLOBAL_KEY,
			HOTKEY_KEY,
			SITE_SETTINGS_KEY,
			GLOBAL_PRESETS_KEY,
			DEFAULT_PRESET_KEY,
			MEDIA_ROUTES_KEY,
			...LEGACY_MEDIA_ROUTE_KEYS,
			META_KEY,
		]);
		let meta = parseMeta(result[META_KEY]);
		const rawMeta = result[META_KEY];
		const requiresMigration = meta === null
			|| !isRecord(rawMeta)
			|| rawMeta.schemaVersion !== SETTINGS_STORAGE_SCHEMA_VERSION
			|| !Object.hasOwn(result, MEDIA_ROUTES_KEY);
		const globalSettings = normalizeGlobalSettings(result[GLOBAL_KEY], requiresMigration);
		const hotkeyNormalization = normalizeHotkeySettings(result[HOTKEY_KEY]);
		const hotkeySettings = hotkeyNormalization.settings;
		const normalizedSiteSettings = normalizeSiteSettings(result[SITE_SETTINGS_KEY]) ?? {};
		const normalizedPresets = normalizePresetState(
			result[GLOBAL_PRESETS_KEY],
			result[DEFAULT_PRESET_KEY],
			Object.hasOwn(result, DEFAULT_PRESET_KEY),
		);
		const normalizedMediaRoutes = normalizeMediaRoutes(selectMediaRouteStorageValue(result));
		const snapshot = createSettingsSnapshot(
			meta?.revision ?? 0,
			globalSettings,
			hotkeySettings,
			normalizedSiteSettings,
			normalizedPresets.globalPresets,
			normalizedPresets.defaultPresetId,
		);

		if (requiresMigration) {
			const rawGlobal = isRecord(result[GLOBAL_KEY]) ? result[GLOBAL_KEY] : {};
			const rawHotkeys = isRecord(result[HOTKEY_KEY]) ? result[HOTKEY_KEY] : {};
			const migratedValues: Record<string, unknown> = {
				[GLOBAL_KEY]: { ...rawGlobal, ...globalSettings },
				[HOTKEY_KEY]: { ...rawHotkeys, ...hotkeySettings },
				[GLOBAL_PRESETS_KEY]: normalizedPresets.globalPresets,
				[DEFAULT_PRESET_KEY]: normalizedPresets.defaultPresetId,
				[MEDIA_ROUTES_KEY]: normalizedMediaRoutes,
			};
			if (Object.keys(normalizedSiteSettings).length > 0) {
				migratedValues[SITE_SETTINGS_KEY] = normalizedSiteSettings;
			}

			// Two-phase migration: persist and read back data before marking the current schema complete.
			await this.local.set(migratedValues);
			const verified = await this.local.get([
				GLOBAL_KEY,
				HOTKEY_KEY,
				GLOBAL_PRESETS_KEY,
				DEFAULT_PRESET_KEY,
				MEDIA_ROUTES_KEY,
				...(Object.keys(normalizedSiteSettings).length > 0 ? [SITE_SETTINGS_KEY] : []),
			]);
			if (!isRecord(verified[GLOBAL_KEY]) || !isRecord(verified[HOTKEY_KEY])) {
				throw new Error('Settings migration verification failed');
			}
			if (!isRecord(verified[GLOBAL_PRESETS_KEY])
				|| !isMediaRouteSettings(verified[MEDIA_ROUTES_KEY], MAX_SETTINGS_SNAPSHOT_ENTRIES)
				|| verified[DEFAULT_PRESET_KEY] !== normalizedPresets.defaultPresetId
				|| (Object.keys(normalizedSiteSettings).length > 0 && !isRecord(verified[SITE_SETTINGS_KEY]))) {
				throw new Error('Settings migration verification failed');
			}
			meta = {
				schemaVersion: SETTINGS_STORAGE_SCHEMA_VERSION,
				revision: snapshot.revision,
				migratedAt: meta?.migratedAt ?? Date.now(),
			};
			await this.local.set({ [META_KEY]: meta });
			await this.local.remove?.([...LEGACY_MEDIA_ROUTE_KEYS]);
		} else if (hotkeyNormalization.requiresPersistence) {
			const rawHotkeys = isRecord(result[HOTKEY_KEY]) ? result[HOTKEY_KEY] : {};
			await this.local.set({
				[HOTKEY_KEY]: { ...rawHotkeys, ...hotkeySettings },
			});
		}
		if (!meta) throw new Error('Settings metadata was not initialized');

		return snapshot;
	}

	private async readValues(keys: string[]): Promise<Record<string, unknown>> {
		return this.local.get(keys);
	}

	private async readMediaRoutes(): Promise<MediaRouteSettings> {
		const result = await this.readValues([MEDIA_ROUTES_KEY, ...LEGACY_MEDIA_ROUTE_KEYS]);
		const primary = normalizeMediaRoutes(result[MEDIA_ROUTES_KEY]);
		if (Object.keys(primary).length > 0 || !Object.hasOwn(result, MEDIA_ROUTES_KEY)) return primary;
		// A pre-v3 profile whose one-shot schema migration ran before its route
		// data existed would otherwise strand `mediaRouteRegistry` forever: the
		// meta gate never reopens, and the primary-key selector ignores legacy
		// values whenever the primary key exists. Re-adopt any legacy projection
		// that still holds entries.
		for (const key of LEGACY_MEDIA_ROUTE_KEYS) {
			if (!Object.hasOwn(result, key)) continue;
			const legacy = normalizeMediaRoutes(result[key]);
			if (Object.keys(legacy).length === 0) continue;
			await this.local.set({ [MEDIA_ROUTES_KEY]: legacy });
			await this.local.remove?.([key]);
			return legacy;
		}
		return primary;
	}

	private async persistMediaRoutes(routes: MediaRouteSettings, revision: number): Promise<void> {
		const snapshot = await this.readState();
		const routeCount = Object.keys(routes).length;
		if (Object.keys(snapshot.audioSites).length + Object.keys(snapshot.audioPresets).length + routeCount
			> MAX_SETTINGS_SNAPSHOT_ENTRIES) {
			throw new SettingsCapacityError(
				Object.keys(snapshot.audioSites).length,
				Object.keys(snapshot.audioPresets).length,
				routeCount,
			);
		}
		const stored = await this.readValues([META_KEY]);
		const previousMeta = parseMeta(stored[META_KEY]);
		await this.local.set({
			[MEDIA_ROUTES_KEY]: routes,
			[META_KEY]: {
				schemaVersion: SETTINGS_STORAGE_SCHEMA_VERSION,
				revision,
				migratedAt: previousMeta?.migratedAt ?? Date.now(),
			} satisfies SettingsMeta,
		});
	}

	private serialized<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation, operation);
		this.operationQueue = result.then(() => undefined, () => undefined);
		return result;
	}
}

export const settingsRepository = new SettingsRepository();
