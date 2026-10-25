import { describe, expect, test } from 'bun:test';
import { DEFAULT_GLOBAL_SETTINGS } from '@nexus/contracts';
import {
	mergeCanonicalAudioConfig,
	normalizeGlobalSettings,
	normalizeHotkeySettings,
	normalizePresetState,
	normalizeSiteSettings,
	isSnapshotPresetName,
	sanitizeBinding,
	snapshotAudioPatch,
} from '../src/background/settings-value-normalization';

describe('settings value normalization', () => {
	test('normalizes global aliases, supported values, and bounded retention', () => {
		expect(normalizeGlobalSettings({
			language: 'es-ES',
			theme: 'dark',
			pauseRetentionSeconds: 999_999,
		}, true)).toMatchObject({
			lang: 'es-ES',
			themeMode: 'dark',
			pauseRetentionSeconds: 86_400,
		});
		expect(normalizeGlobalSettings({
			lang: 'ja-JP',
			language: 'es-ES',
			themeMode: 'light',
			theme: 'dark',
		}, false)).toMatchObject({
			lang: 'ja-JP',
			themeMode: 'light',
		});
		expect(normalizeGlobalSettings({ lang: 'xx', themeMode: 'xx' }, false)).toEqual(DEFAULT_GLOBAL_SETTINGS);
	});

	test('canonicalizes hotkey sites and records disabled legacy bindings', () => {
		const result = normalizeHotkeySettings({
			slots: { custom_mono: 'mono_toggle', invalid: 'pitch_up' },
			sites: {
				'EXAMPLE.COM.': {
					enabled: true,
					bindings: [{
						id: 'legacy-pitch',
						enabled: true,
						key: { code: 'KeyP', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
						action: 'pitch_up',
					}],
				},
			},
		});

		expect(result.settings.slots).toEqual({ custom_mono: 'mono_toggle' });
		expect(result.settings.sites['example.com']).toMatchObject({ enabled: true });
		expect(result.settings.sites['example.com']?.bindings[0]).toMatchObject({
			enabled: false,
			disabledReason: 'unsupported_action',
		});
		expect(result.settings.disabledLegacyBindings).toEqual([
			expect.objectContaining({ id: 'legacy-pitch', disabledReason: 'unsupported_action' }),
		]);
		expect(result.requiresPersistence).toBe(true);
	});

	test('merges normalized site keys while preserving unknown fields', () => {
		expect(normalizeSiteSettings({
			'EXAMPLE.COM.': { delay: -5, firstFutureField: true },
			'example.com': { delay: 999, secondFutureField: true },
		})).toEqual({
			'example.com': {
				delay: 500,
				firstFutureField: true,
				secondFutureField: true,
			},
		});
	});

	test('selects a deterministic preset fallback and synchronizes canonical flags', () => {
		const result = normalizePresetState({
			Zulu: {
				config: { delay: -50 },
				meta: { type: 'global', name: 'Zulu', createdAt: 2, isDefault: true },
			},
			Alpha: {
				config: { volume: 120 },
				meta: { type: 'global', name: 'Alpha', createdAt: 1 },
				isDefault: true,
			},
		}, undefined, false);

		expect(result.defaultPresetId).toBe('Alpha');
		expect(result.globalPresets.Alpha).toMatchObject({ meta: { isDefault: true } });
		expect(result.globalPresets.Zulu).toMatchObject({
			config: { delay: 0 },
			meta: { isDefault: false },
		});
	});

	test('keeps coupled audio projections canonical and copies mutable values', () => {
		expect(mergeCanonicalAudioConfig({ volume: 80 }, { boost: 2 }, 'merge')).toMatchObject({
			volume: 160,
			volumeBase: 80,
			boost: 2,
		});
		expect(mergeCanonicalAudioConfig({}, { volume: 80 }, 'replace')).toMatchObject({
			volume: 80,
			volumeBase: 80,
			boost: 1,
		});

		const eqValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const patch = snapshotAudioPatch({ volume: 150, delay: -2, eqValues });
		eqValues[0] = 99;
		expect(patch).toMatchObject({ volume: 150, volumeBase: 100, boost: 1.5, delay: 0 });
		expect(patch.eqValues).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	test('keeps malformed bindings and unsafe preset names out of canonical values', () => {
		expect(sanitizeBinding({ id: '', enabled: true })).toBeNull();
		expect(isSnapshotPresetName('Valid preset')).toBe(true);
		expect(isSnapshotPresetName('__proto__')).toBe(false);
		expect(isSnapshotPresetName('bad\u0000name')).toBe(false);
	});
});
