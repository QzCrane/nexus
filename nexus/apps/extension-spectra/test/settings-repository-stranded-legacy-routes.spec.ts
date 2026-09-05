import { describe, expect, test } from 'bun:test';
import type { SettingsStorageArea } from '../src/background/settings-repository';
import { SettingsRepository } from '../src/background/settings-repository';

class FakeStorageArea implements SettingsStorageArea {
	readonly values: Record<string, unknown>;
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
		Object.assign(this.values, structuredClone(items));
	}
	async remove(keys: string | string[]): Promise<void> {
		for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
	}
}

describe('stranded legacy media routes', () => {
	test('re-adopts mediaRouteRegistry after the one-shot migration consumed schema v3', async () => {
		const storage = new FakeStorageArea({
			spectraSettingsMeta: { schemaVersion: 3, revision: 4, migratedAt: 1 },
			siteProcessingRoutes: {},
			globalSettings: {},
			hotkeySettings: {},
			mediaRouteRegistry: [
				{ domain: 'bilibili.com', fingerprint: 'site:bilibili.com', route: 'direct', source: 'user', updatedAt: 1735689600000 },
				{ domain: 'youtube.com', fingerprint: 'site:youtube.com', route: 'capture', source: 'auto', updatedAt: 1735689500000 },
			],
		});
		const repository = new SettingsRepository(storage);
		const snapshot = await repository.getMediaRouteSnapshot();
		expect(snapshot.entries.map((entry) => entry.domain)).toEqual(['bilibili.com', 'youtube.com']);
		expect(storage.values.siteProcessingRoutes).toBeTruthy();
		expect(storage.values.mediaRouteRegistry).toBeUndefined();
	});

	test('wraps legacy bare-config presets and still excludes opaque unknown shapes', async () => {
		const eqValues = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		const storage = new FakeStorageArea({
			spectraSettingsMeta: { schemaVersion: 3, revision: 7, migratedAt: 1 },
			globalPresets: {
				'夜听': { enabled: true, volume: 60, volumeBase: 60, boost: 1, muted: false, compressor: false, mono: false, bass: true, eqValues, pan: 0, delay: 0, speed: 1, preservePitch: true },
				opaqueFutureEntry: { futureShape: 'keep-me' },
			},
			globalSettings: {},
			hotkeySettings: {},
		});
		const repository = new SettingsRepository(storage);
		const snapshot = await repository.getSnapshot();
		expect(snapshot.audioPresets.夜听?.config.volume).toBe(60);
		expect(snapshot.audioPresets.夜听?.meta.type).toBe('global');
		expect(snapshot.audioPresets.opaqueFutureEntry).toBeUndefined();	});
});
