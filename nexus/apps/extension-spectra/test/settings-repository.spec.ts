import { describe, expect, test } from 'bun:test';
import { SPECTRA_SETTINGS_SCHEMA_VERSION } from '@nexus/contracts';
import type { SettingsStorageArea } from '../src/background/settings-repository';
import {
	InvalidSettingsPatchError,
	SettingsRepository,
	SettingsRevisionConflictError,
} from '../src/background/settings-repository';

class FakeStorageArea implements SettingsStorageArea {
	readonly values: Record<string, unknown>;
	readonly writes: Array<Record<string, unknown>> = [];
	setFailuresRemaining = 0;

	constructor(initial: Record<string, unknown> = {}) {
		this.values = structuredClone(initial);
	}

	async get(keys: string | string[]): Promise<Record<string, unknown>> {
		const result: Record<string, unknown> = {};
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			if (key in this.values) result[key] = structuredClone(this.values[key]);
		}
		return result;
	}

	async set(items: Record<string, unknown>): Promise<void> {
		const copy = structuredClone(items);
		this.writes.push(copy);
		if (this.setFailuresRemaining > 0) {
			this.setFailuresRemaining -= 1;
			throw new Error('local storage unavailable');
		}
		Object.assign(this.values, copy);
	}
}

const legacyPitchBinding = {
	id: 'legacy-pitch',
	enabled: true,
	key: { code: 'KeyP', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
	action: 'pitch_up',
};

describe('background settings repository', () => {
	test('performs a two-phase idempotent migration and merges legacy default flags deterministically', async () => {
		const storage = new FakeStorageArea({
			globalSettings: { lang: 'en-US', language: 'es-ES', extensionOwned: 'keep-me' },
			hotkeySettings: {
				slots: { slot_01: 'toggle_mute' },
				sites: { 'EXAMPLE.COM.': { enabled: true, bindings: [legacyPitchBinding] } },
				futureField: { retained: true },
			},
			siteSettings: { 'EXAMPLE.COM.': { volume: 150, delay: -250, futureAudioField: true } },
			globalPresets: {
				Zulu: {
					config: { volume: 140, delay: -50, futureConfigField: 'zulu' },
					meta: { type: 'global', name: 'Zulu', createdAt: 2, isDefault: true, futureMetaField: 'zulu' },
					futurePresetField: 'zulu',
				},
				Alpha: {
					config: { volume: 120 },
					meta: { type: 'global', name: 'Alpha', createdAt: 1, futureMetaField: 'alpha' },
					isDefault: true,
				},
				opaqueFutureEntry: { futureShape: 'keep-me' },
			},
		});
		const repository = new SettingsRepository(storage);

		const first = await repository.initialize();
		const writesAfterMigration = storage.writes.length;
		const second = await repository.initialize();

		expect(first.revision).toBe(0);
		expect(second.revision).toBe(0);
		expect(first.globalSettings.lang).toBe('es-ES');
		expect(first.hotkeySettings.sites['example.com']?.bindings[0]?.enabled).toBe(false);
		expect(first.hotkeySettings.disabledLegacyBindings?.[0]?.disabledReason).toBe('unsupported_action');
		expect(first.audioSites['example.com']).toEqual({
			volume: 150,
			volumeBase: 100,
			boost: 1.5,
			delay: 0,
		});
		expect(first.audioPresets.Alpha?.meta.isDefault).toBe(true);
		expect(first.audioPresets.Zulu?.config.delay).toBe(0);
		expect(first.defaultPresetId).toBe('Alpha');
		expect(storage.writes).toHaveLength(2);
		expect(writesAfterMigration).toBe(2);
		expect(storage.writes[0]?.spectraSettingsMeta).toBeUndefined();
		expect(Object.keys(storage.writes[1] ?? {})).toEqual(['spectraSettingsMeta']);
		expect((storage.values.globalSettings as Record<string, unknown>).extensionOwned).toBe('keep-me');
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).legacyThemeModeMissing).toBe(true);
		expect((storage.values.hotkeySettings as Record<string, unknown>).futureField).toEqual({ retained: true });
		expect((storage.values.siteSettings as Record<string, Record<string, unknown>>)['example.com']?.delay).toBe(0);
		expect((storage.values.siteSettings as Record<string, Record<string, unknown>>)['example.com']?.futureAudioField).toBe(true);
		expect(storage.values.defaultPresetId).toBe('Alpha');

		const presets = storage.values.globalPresets as Record<string, Record<string, unknown>>;
		expect((presets.Alpha as Record<string, Record<string, unknown>>).meta?.isDefault).toBe(true);
		expect((presets.Zulu as Record<string, Record<string, unknown>>).meta?.isDefault).toBe(false);
		expect((presets.Zulu as Record<string, Record<string, unknown>>).config?.delay).toBe(0);
		expect((presets.Zulu as Record<string, unknown>).futurePresetField).toBe('zulu');
		expect((presets.Zulu as Record<string, Record<string, unknown>>).meta?.futureMetaField).toBe('zulu');
		expect((presets.Zulu as Record<string, Record<string, unknown>>).config?.futureConfigField).toBe('zulu');
		expect(presets.opaqueFutureEntry).toEqual({ futureShape: 'keep-me' });
	});

	test('merges legacy site keys that collide after hostname normalization', async () => {
		const firstBinding = {
			id: 'first',
			enabled: true,
			key: { code: 'KeyA', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
			action: 'volume_up',
		};
		const secondBinding = {
			id: 'second',
			enabled: true,
			key: { code: 'KeyB', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
			action: 'volume_down',
		};
		const storage = new FakeStorageArea({
			hotkeySettings: {
				sites: {
					'EXAMPLE.COM.': { enabled: true, bindings: [firstBinding] },
					'example.com': { enabled: false, bindings: [secondBinding] },
				},
			},
			siteSettings: {
				'EXAMPLE.COM.': { volume: 150, delay: -50, firstFutureField: true },
				'example.com': { pan: 0.25, secondFutureField: true },
			},
		});
		const repository = new SettingsRepository(storage);

		const first = await repository.initialize();
		const writesAfterMigration = storage.writes.length;
		const second = await repository.initialize();

		expect(first.hotkeySettings.sites['example.com']?.enabled).toBe(true);
		expect(first.hotkeySettings.sites['example.com']?.bindings.map(({ id }) => id)).toEqual([
			'first',
			'second',
		]);
		expect(first.audioSites['example.com']).toEqual({
			volume: 150,
			volumeBase: 100,
			boost: 1.5,
			delay: 0,
			pan: 0.25,
		});
		expect(second.hotkeySettings.sites['example.com']).toEqual(first.hotkeySettings.sites['example.com']);
		expect(storage.writes).toHaveLength(writesAfterMigration);
		const persistedSite = (storage.values.siteSettings as Record<string, Record<string, unknown>>)['example.com'];
		expect(persistedSite).toMatchObject({
			volume: 150,
			delay: 0,
			pan: 0.25,
			firstFutureField: true,
			secondFutureField: true,
		});
	});

	test('atomically consumes a legacy theme candidate exactly once', async () => {
		const storage = new FakeStorageArea({
			globalSettings: { osdEnabled: true, futureGlobalField: 'keep-me' },
		});
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();

		expect(initial.globalSettings.themeMode).toBe('system');
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).legacyThemeModeMissing).toBe(true);
		const first = await repository.applyPatch(
			{ scope: 'legacy-theme', candidate: 'dark' },
			initial.revision,
		);
		await expect(repository.applyPatch(
			{ scope: 'legacy-theme', candidate: 'light' },
			initial.revision,
		)).rejects.toBeInstanceOf(SettingsRevisionConflictError);
		const second = await repository.applyPatch(
			{ scope: 'legacy-theme', candidate: 'light' },
			first.revision,
		);

		expect(first.globalSettings.themeMode).toBe('dark');
		expect(first.revision).toBe(1);
		expect(second.globalSettings.themeMode).toBe('dark');
		expect(second.revision).toBe(1);
		await repository.flush();
		expect((storage.values.globalSettings as Record<string, unknown>).themeMode).toBe('dark');
		expect((storage.values.globalSettings as Record<string, unknown>).futureGlobalField).toBe('keep-me');
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).legacyThemeModeMissing).toBe(false);
	});

	test('consumes a missing legacy theme without changing the public revision', async () => {
		const storage = new FakeStorageArea();
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();

		const result = await repository.applyPatch(
			{ scope: 'legacy-theme', candidate: null },
			initial.revision,
		);
		expect(result.revision).toBe(initial.revision);
		await repository.flush();
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).legacyThemeModeMissing).toBe(false);
	});

	test('never lets a late legacy candidate overwrite a v2 theme patch', async () => {
		const storage = new FakeStorageArea();
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();

		const modern = await repository.applyPatch(
			{ scope: 'global', changes: { themeMode: 'light' } },
			initial.revision,
		);
		await expect(repository.applyPatch(
			{ scope: 'legacy-theme', candidate: 'dark' },
			initial.revision,
		)).rejects.toBeInstanceOf(SettingsRevisionConflictError);
		const legacy = await repository.applyPatch(
			{ scope: 'legacy-theme', candidate: 'dark' },
			modern.revision,
		);

		expect(modern.globalSettings.themeMode).toBe('light');
		expect(legacy.globalSettings.themeMode).toBe('light');
		expect(legacy.revision).toBe(modern.revision);
		await repository.flush();
		expect((storage.values.globalSettings as Record<string, unknown>).themeMode).toBe('light');
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).legacyThemeModeMissing).toBe(false);
	});

	test('retains legacy global aliases for one release without updating them', async () => {
		const storage = new FakeStorageArea({
			globalSettings: {
				language: 'es-ES',
				theme: 'dark',
				futureGlobalField: 'keep-me',
			},
		});
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();

		expect(initial.globalSettings).toMatchObject({ lang: 'es-ES', themeMode: 'dark' });
		const modern = await repository.applyPatch({
			scope: 'global',
			changes: { lang: 'de-DE', themeMode: 'light' },
		}, initial.revision);
		expect(modern.globalSettings).toMatchObject({ lang: 'de-DE', themeMode: 'light' });
		await repository.flush();

		const persisted = storage.values.globalSettings as Record<string, unknown>;
		expect(persisted).toMatchObject({
			lang: 'de-DE',
			themeMode: 'light',
			language: 'es-ES',
			theme: 'dark',
			futureGlobalField: 'keep-me',
		});
	});

	test('serializes concurrent audio patches and durably commits each accepted revision', async () => {
		const storage = new FakeStorageArea();
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();
		const migrationWrites = storage.writes.length;

		const [siteAttempt, presetAttempt] = await Promise.allSettled([
			repository.applyPatch({
				scope: 'audio-site',
				domain: 'MUSIC.EXAMPLE.COM.',
				value: { volume: 160 },
			}, initial.revision),
			repository.applyPatch({
				scope: 'audio-preset',
				name: 'Voice',
				value: {
					config: { mono: true },
					meta: { type: 'global', name: 'Voice', createdAt: 1 },
				},
			}, initial.revision),
		]);

		expect(siteAttempt.status).toBe('fulfilled');
		expect(presetAttempt.status).toBe('rejected');
		if (siteAttempt.status !== 'fulfilled' || presetAttempt.status !== 'rejected') {
			throw new Error('Unexpected concurrent patch result');
		}
		expect(siteAttempt.value.revision).toBe(1);
		expect(siteAttempt.value.audioSites['music.example.com']?.volume).toBe(160);
		expect(presetAttempt.reason).toBeInstanceOf(SettingsRevisionConflictError);
		expect((presetAttempt.reason as SettingsRevisionConflictError).currentRevision).toBe(1);

		const preset = await repository.applyPatch({
			scope: 'audio-preset',
			name: 'Voice',
			value: {
				config: { mono: true },
				meta: { type: 'global', name: 'Voice', createdAt: 1 },
			},
		}, 1);
		expect(preset.revision).toBe(2);
		expect(preset.audioPresets.Voice?.config.mono).toBe(true);

		const [defaultAttempt, staleSiteAttempt] = await Promise.allSettled([
			repository.applyPatch({ scope: 'default-preset', value: 'Voice' }, 2),
			repository.applyPatch({
				scope: 'audio-site',
				domain: 'other.example',
				value: { volume: 90 },
			}, 2),
		]);
		expect(defaultAttempt.status).toBe('fulfilled');
		expect(staleSiteAttempt.status).toBe('rejected');
		if (defaultAttempt.status !== 'fulfilled' || staleSiteAttempt.status !== 'rejected') {
			throw new Error('Unexpected concurrent default patch result');
		}
		expect(defaultAttempt.value.revision).toBe(3);
		expect(defaultAttempt.value.defaultPresetId).toBe('Voice');
		expect((staleSiteAttempt.reason as SettingsRevisionConflictError).currentRevision).toBe(3);
		expect(storage.writes).toHaveLength(migrationWrites + 3);

		await repository.flush();
		expect(storage.writes).toHaveLength(migrationWrites + 3);
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).revision).toBe(3);
		expect(storage.values.defaultPresetId).toBe('Voice');
		expect((storage.values.siteSettings as Record<string, Record<string, unknown>>)['music.example.com']?.volume).toBe(160);
		expect((storage.values.siteSettings as Record<string, unknown>)['other.example']).toBeUndefined();
		const voice = requireRecord((storage.values.globalPresets as Record<string, unknown>).Voice);
		expect(requireRecord(voice.config).mono).toBe(true);
		expect(requireRecord(voice.meta).isDefault).toBe(true);
	});

	test('preserves unknown audio fields and deterministically falls back when deleting the default preset', async () => {
		const storage = new FakeStorageArea({
			globalSettings: { futureGlobalField: 'keep-global' },
			hotkeySettings: { futureHotkeyField: 'keep-hotkey' },
			siteSettings: {
				'example.com': { volume: 110, delay: 25, futureSiteField: 'keep-site' },
			},
			globalPresets: {
				Zulu: presetEntry('Zulu', 3, { volume: 130 }),
				Middle: {
					...presetEntry('Middle', 2, { volume: 120, futureConfigField: 'keep-config' }),
					futurePresetField: 'keep-preset',
					meta: {
						type: 'global',
						name: 'Middle',
						createdAt: 2,
						isDefault: true,
						futureMetaField: 'keep-meta',
					},
				},
				Alpha: presetEntry('Alpha', 1, { volume: 100 }),
			},
			defaultPresetId: 'Middle',
			spectraSettingsMeta: validMeta(0),
		});
		const repository = new SettingsRepository(storage);

		await repository.initialize();
		const site = await repository.applyPatch({
			scope: 'audio-site',
			domain: 'example.com',
			value: { volume: 175 },
			mode: 'replace',
		}, 0);
		const preset = await repository.applyPatch({
			scope: 'audio-preset',
			name: 'Middle',
			value: {
				config: { pan: 0.2 },
				meta: { type: 'global', name: 'Middle', createdAt: 20 },
			},
		}, site.revision);
		await repository.applyPatch({ scope: 'audio-preset', name: 'Middle', value: null }, preset.revision);
		await repository.flush();

		expect(storage.values.defaultPresetId).toBe('Alpha');
		const siteSettings = (storage.values.siteSettings as Record<string, Record<string, unknown>>)['example.com'];
		expect(siteSettings?.volume).toBe(175);
		expect(siteSettings?.delay).toBe(0);
		expect(siteSettings?.futureSiteField).toBe('keep-site');
		expect((storage.values.globalSettings as Record<string, unknown>).futureGlobalField).toBe('keep-global');
		expect((storage.values.hotkeySettings as Record<string, unknown>).futureHotkeyField).toBe('keep-hotkey');
		const presets = storage.values.globalPresets as Record<string, Record<string, unknown>>;
		expect(presets.Middle).toBeUndefined();
		expect(requireRecord(requireRecord(presets.Alpha).meta).isDefault).toBe(true);
		expect(requireRecord(requireRecord(presets.Zulu).meta).isDefault).toBe(false);
	});

	test('preserves unknown preset fields while patching an existing preset', async () => {
		const storage = new FakeStorageArea({
			globalPresets: {
				Voice: {
					config: { volume: 130, futureConfigField: 'keep-config' },
					meta: {
						type: 'global',
						name: 'Voice',
						createdAt: 1,
						isDefault: true,
						futureMetaField: 'keep-meta',
					},
					futurePresetField: 'keep-preset',
				},
			},
			defaultPresetId: 'Voice',
			spectraSettingsMeta: validMeta(0),
		});
		const repository = new SettingsRepository(storage);
		await repository.initialize();
		await repository.applyPatch({
			scope: 'audio-preset',
			name: 'Voice',
			value: {
				config: { delay: 75 },
				meta: { type: 'global', name: 'Voice', createdAt: 2 },
			},
		}, 0);
		await repository.flush();

		const voice = requireRecord((storage.values.globalPresets as Record<string, unknown>).Voice);
		const voiceConfig = requireRecord(voice.config);
		const voiceMeta = requireRecord(voice.meta);
		expect(voice.futurePresetField).toBe('keep-preset');
		expect(voiceConfig.volume).toBe(130);
		expect(voiceConfig.delay).toBe(75);
		expect(voiceConfig.futureConfigField).toBe('keep-config');
		expect(voiceMeta.createdAt).toBe(2);
		expect(voiceMeta.futureMetaField).toBe('keep-meta');
		expect(voiceMeta.isDefault).toBe(true);
	});

	test('persists every successful settings revision before returning it', async () => {
		const storage = new FakeStorageArea();
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();
		const migrationWrites = storage.writes.length;
		const first = await repository.applyPatch(
			{ scope: 'global', changes: { osdEnabled: false } },
			initial.revision,
		);
		expect(storage.writes).toHaveLength(migrationWrites + 1);
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).revision).toBe(1);
		expect((storage.values.globalSettings as Record<string, unknown>).osdEnabled).toBe(false);

		await repository.applyPatch(
			{ scope: 'global', changes: { visualizerEnabled: false } },
			first.revision,
		);
		expect(storage.writes).toHaveLength(migrationWrites + 2);
		expect((storage.values.spectraSettingsMeta as Record<string, unknown>).revision).toBe(2);
		expect((storage.values.globalSettings as Record<string, unknown>).visualizerEnabled).toBe(false);

		await repository.flush();
		expect(storage.writes).toHaveLength(migrationWrites + 2);
	});

	test('does not acknowledge site and global presets before a replacement worker can read them', async () => {
		const storage = new FakeStorageArea({
			globalSettings: {},
			hotkeySettings: {},
			siteSettings: {},
			globalPresets: {
				Default: presetEntry('Default', 1, { volume: 135, speed: 1.25 }),
			},
			defaultPresetId: 'Default',
			spectraSettingsMeta: validMeta(0),
		});
		const repository = new SettingsRepository(storage);
		const site = await repository.applyPatch({
			scope: 'audio-site',
			domain: 'MEDIA.EXAMPLE.COM.',
			value: { volume: 175, speed: 1.75 },
			mode: 'replace',
		}, 0);
		expect(site.revision).toBe(1);

		const replacementWorkerRepository = new SettingsRepository(storage);
		expect(await replacementWorkerRepository.resolveAudioConfig('media.example.com')).toMatchObject({
			volume: 175,
			speed: 1.75,
		});
		expect(await replacementWorkerRepository.resolveAudioConfig('other.example.com')).toMatchObject({
			volume: 135,
			speed: 1.25,
		});
	});

	test('does not publish a settings revision whose physical write failed', async () => {
		const storage = new FakeStorageArea();
		const repository = new SettingsRepository(storage);
		const initial = await repository.initialize();
		storage.setFailuresRemaining = 1;

		await expect(repository.applyPatch(
			{ scope: 'global', changes: { osdEnabled: false } },
			initial.revision,
		)).rejects.toThrow('local storage unavailable');
		const replacementWorkerRepository = new SettingsRepository(storage);
		expect(await replacementWorkerRepository.getSnapshot()).toMatchObject({
			revision: initial.revision,
			globalSettings: { osdEnabled: true },
		});
	});

	test('applies hotkey field patches without clobbering another editor', async () => {
		const repository = new SettingsRepository(new FakeStorageArea());
		const initial = await repository.initialize();
		const slots = await repository.applyPatch(
			{ scope: 'hotkey-slots', changes: { slot_01: 'play_pause' } },
			initial.revision,
		);

		await expect(repository.applyPatch(
			{ scope: 'hotkey-site', domain: 'music.example.com', value: { enabled: true, bindings: [] } },
			initial.revision,
		)).rejects.toBeInstanceOf(SettingsRevisionConflictError);

		const site = await repository.applyPatch(
			{ scope: 'hotkey-site', domain: 'music.example.com', value: { enabled: true, bindings: [] } },
			slots.revision,
		);
		expect(site.hotkeySettings.slots.slot_01).toBe('play_pause');
		expect(site.hotkeySettings.sites['music.example.com']?.enabled).toBe(true);
		await repository.flush();
	});

	test('rejects parameterized, disabled and holdable actions from Chrome command slots', async () => {
		const repository = new SettingsRepository(new FakeStorageArea());
		const initial = await repository.initialize();
		for (const action of ['speed_set', 'pitch_up', 'volume_down', 'seek_forward_5s'] as const) {
			await expect(repository.applyPatch(
				{ scope: 'hotkey-slots', changes: { slot_01: action } },
				initial.revision,
			)).rejects.toBeInstanceOf(InvalidSettingsPatchError);
		}
	});

	test('removes invalid legacy Chrome command slots during normalization', async () => {
		const repository = new SettingsRepository(new FakeStorageArea({
			hotkeySettings: {
				slots: { slot_01: 'speed_set', slot_02: 'pitch_up', slot_03: 'volume_down' },
				sites: {},
			},
		}));
		const snapshot = await repository.initialize();
		expect(snapshot.hotkeySettings.slots.slot_01).toBeUndefined();
		expect(snapshot.hotkeySettings.slots.slot_02).toBeUndefined();
		expect(snapshot.hotkeySettings.slots.slot_03).toBeUndefined();
	});

	test('removes legacy site bindings whose required parameters are missing or unsafe', async () => {
		const binding = (id: string, action: 'speed_set' | 'volume_set' | 'open_url', params?: Record<string, unknown>) => ({
			id,
			enabled: true,
			key: { code: `Key${id}`, modifiers: { ctrl: false, alt: false, shift: false, meta: false } },
			action,
			...(params ? { params } : {}),
		});
		const repository = new SettingsRepository(new FakeStorageArea({
			hotkeySettings: {
				slots: {},
				sites: {
					'example.com': {
						enabled: true,
						bindings: [
							binding('A', 'speed_set'),
							binding('B', 'open_url', { url: 'javascript:alert(1)' }),
							binding('C', 'speed_set', { speed: 1.5 }),
							binding('D', 'volume_set', { volume: 800 }),
						],
					},
				},
			},
		}));
		const snapshot = await repository.initialize();
		expect(snapshot.hotkeySettings.sites['example.com']?.bindings.map(({ id }) => id)).toEqual(['C', 'D']);
		expect(snapshot.hotkeySettings.sites['example.com']?.bindings[1]).toMatchObject({
			enabled: true,
			params: { volume: 800 },
		});
		expect(snapshot.hotkeySettings.disabledLegacyBindings?.map(({ id }) => id) ?? []).not.toContain('D');
	});

	test('applies binding-level site mutations against the latest repository state', async () => {
		const repository = new SettingsRepository(new FakeStorageArea());
		const initial = await repository.initialize();
		const site = await repository.applyPatch({
			scope: 'hotkey-site-mutation',
			domain: 'MUSIC.EXAMPLE.COM.',
			mutation: { type: 'ensure-site', enabled: true },
		}, initial.revision);
		const first = await repository.applyPatch({
			scope: 'hotkey-site-mutation',
			domain: 'music.example.com',
			mutation: {
				type: 'upsert-binding',
				binding: {
					id: 'first',
					enabled: true,
					key: { code: 'KeyA', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
					action: 'volume_up',
				},
			},
		}, site.revision);
		const second = await repository.applyPatch({
			scope: 'hotkey-site-mutation',
			domain: 'music.example.com',
			mutation: {
				type: 'upsert-binding',
				binding: {
					id: 'second',
					enabled: true,
					key: { code: 'KeyB', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
					action: 'volume_down',
				},
			},
		}, first.revision);

		expect(second.hotkeySettings.sites['music.example.com']).toMatchObject({ enabled: true });
		expect(second.hotkeySettings.sites['music.example.com']?.bindings.map(({ id }) => id)).toEqual([
			'first',
			'second',
		]);
		const removed = await repository.applyPatch({
			scope: 'hotkey-site-mutation',
			domain: 'music.example.com',
			mutation: { type: 'remove-binding', bindingId: 'first' },
		}, second.revision);
		expect(removed.hotkeySettings.sites['music.example.com']?.bindings.map(({ id }) => id)).toEqual(['second']);
		await repository.flush();
	});

	test('resolves the most-specific domain rule while keeping IP rules exact', async () => {
		const repository = new SettingsRepository(new FakeStorageArea({
			siteSettings: {
				'example.com': { volume: 110 },
				'music.example.com': { volume: 175 },
				'127.0.0.1': { volume: 200 },
			},
			globalPresets: {},
			defaultPresetId: null,
			spectraSettingsMeta: validMeta(0),
		}));

		expect((await repository.resolveAudioConfig('deep.music.example.com')).volume).toBe(175);
		expect((await repository.resolveAudioConfig('www.example.com')).volume).toBe(110);
		expect((await repository.resolveAudioConfig('notexample.com')).volume).toBe(100);
		expect((await repository.resolveAudioConfig('127.0.0.1')).volume).toBe(200);
		expect((await repository.resolveAudioConfig('x.127.0.0.1')).volume).toBe(100);
	});
});

function presetEntry(name: string, createdAt: number, config: Record<string, unknown>): Record<string, unknown> {
	return {
		config,
		meta: { type: 'global', name, createdAt, isDefault: false },
	};
}

function validMeta(revision: number): Record<string, unknown> {
	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision,
		migratedAt: 1,
	};
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected a settings record');
	}
	return value as Record<string, unknown>;
}
