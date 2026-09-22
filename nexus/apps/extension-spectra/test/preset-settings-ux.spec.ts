import { describe, expect, test } from 'bun:test';
import { isSettingsPatchRequest } from '@nexus/contracts';
import type { SettingsStorageArea } from '../src/background/settings-repository';
import {
	SettingsRepository,
	SettingsRevisionConflictError,
} from '../src/background/settings-repository';
import { EN_US } from '../src/popup/constants/i18n/en';
import { DE_DE } from '../src/popup/constants/i18n/de-DE';
import { ES_ES } from '../src/popup/constants/i18n/es-ES';
import { FR_FR } from '../src/popup/constants/i18n/fr-FR';
import { JA_JP } from '../src/popup/constants/i18n/ja-JP';
import { KO_KR } from '../src/popup/constants/i18n/ko-KR';
import { RU_RU } from '../src/popup/constants/i18n/ru-RU';
import { ZH_CN } from '../src/popup/constants/i18n/zh-CN';
import { ZH_TW } from '../src/popup/constants/i18n/zh-TW';
import { resolvePresetPreviewRows } from '../src/popup/views/presets-ui';

class FakeStorageArea implements SettingsStorageArea {
	readonly values: Record<string, unknown> = {};
	readonly writes: Array<Record<string, unknown>> = [];
	setFailuresRemaining = 0;

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

	async remove(keys: string | string[]): Promise<void> {
		for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
	}
}

async function populatedRepository(): Promise<{
	repository: SettingsRepository;
	storage: FakeStorageArea;
	revision: number;
}> {
	const storage = new FakeStorageArea();
	const repository = new SettingsRepository(storage);
	let snapshot = await repository.initialize();
	snapshot = await repository.applyPatch({
		scope: 'audio-site',
		domain: 'music.example',
		value: { volume: 180 },
	}, snapshot.revision);
	snapshot = await repository.applyPatch({
		scope: 'audio-preset',
		name: 'Voice',
		value: {
			config: { compressor: true },
			meta: { type: 'global', name: 'Voice', createdAt: 1 },
		},
	}, snapshot.revision);
	snapshot = await repository.applyPatch({
		scope: 'default-preset',
		value: 'Voice',
	}, snapshot.revision);
	return { repository, storage, revision: snapshot.revision };
}

describe('preset settings UX owner', () => {
	test('keeps every popup locale on the same complete UX schema', () => {
		const expected = Object.keys(EN_US).sort();
		for (const dictionary of [DE_DE, ES_ES, FR_FR, JA_JP, KO_KR, RU_RU, ZH_CN, ZH_TW]) {
			expect(Object.keys(dictionary).sort()).toEqual(expected);
		}
	});

	test('accepts only the exact atomic clear request shape', () => {
		expect(isSettingsPatchRequest({
			expectedRevision: 0,
			patch: { scope: 'audio-presets-clear' },
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 0,
			patch: { scope: 'audio-presets-clear', name: 'unexpected' },
		})).toBe(false);
	});

	test('clears site/global/default presets in one revision and one storage write', async () => {
		const { repository, storage, revision } = await populatedRepository();
		const writesBeforeClear = storage.writes.length;

		const cleared = await repository.applyPatch({ scope: 'audio-presets-clear' }, revision);

		expect(cleared.revision).toBe(revision + 1);
		expect(cleared.audioSites).toEqual({});
		expect(cleared.audioPresets).toEqual({});
		expect(cleared.defaultPresetId).toBeNull();
		expect(storage.writes).toHaveLength(writesBeforeClear + 1);
		expect(storage.values.siteSettings).toEqual({});
		expect(storage.values.globalPresets).toEqual({});
		expect(storage.values.defaultPresetId).toBeNull();

		await expect(repository.applyPatch(
			{ scope: 'audio-presets-clear' },
			revision,
		)).rejects.toBeInstanceOf(SettingsRevisionConflictError);
	});

	test('does not partially clear persisted presets when the atomic write fails', async () => {
		const { repository, storage, revision } = await populatedRepository();
		const before = structuredClone(storage.values);
		storage.setFailuresRemaining = 1;

		await expect(repository.applyPatch(
			{ scope: 'audio-presets-clear' },
			revision,
		)).rejects.toThrow('local storage unavailable');
		expect(storage.values).toEqual(before);
	});

	test('projects effective, localized preset facts without internal volume fields', () => {
		const rows = resolvePresetPreviewRows({
			volume: 50,
			volumeBase: 100,
			boost: 2,
			speed: 1.25,
			compressor: true,
			delay: 120,
		}, EN_US);
		const projection = rows.map(({ label, value }) => `${label}: ${value}`).join('\n');

		expect(projection).toContain('Volume: 200%');
		expect(projection).toContain('Compressor: On');
		expect(projection).toContain('Delay: 120 ms');
		expect(projection).not.toContain('volumeBase');
		expect(projection).not.toContain('boost');
		expect(projection).not.toContain('{');
	});
});
