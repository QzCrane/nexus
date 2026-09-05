import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_HOTKEY_SETTINGS,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	rpcFailure,
	rpcSuccess,
	type SettingsPatchRequest,
	type SettingsSnapshot,
} from '@nexus/contracts';
import {
	applySettingsPatchWithRetry,
	selectNewestSettingsSnapshot,
} from '../src/shared/settings-client';

function snapshot(revision: number, bindingIds: string[] = []): SettingsSnapshot {
	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision,
		globalSettings: { ...DEFAULT_GLOBAL_SETTINGS },
		hotkeySettings: {
			...DEFAULT_HOTKEY_SETTINGS,
			slots: { ...DEFAULT_HOTKEY_SETTINGS.slots },
			sites: {
				'example.com': {
					enabled: true,
					bindings: bindingIds.map((id, index) => ({
						id,
						enabled: true,
						key: {
							code: `Key${String.fromCharCode(65 + index)}`,
							modifiers: { ctrl: true, alt: false, shift: false, meta: false },
						},
						action: 'volume_up' as const,
					})),
				},
			},
			disabledLegacyBindings: [],
		},
		audioSites: {},
		audioPresets: {},
		defaultPresetId: null,
	};
}

describe('revision-aware settings client', () => {
	test('never lets an older event or delayed read replace a newer cached snapshot', () => {
		const newest = snapshot(7, ['newest']);
		expect(selectNewestSettingsSnapshot(newest, snapshot(6, ['stale']))).toBe(newest);
		expect(selectNewestSettingsSnapshot(snapshot(6), newest)).toBe(newest);
	});

	test('replays one binding-level intent against the refreshed revision', async () => {
		let current = snapshot(1);
		const requests: SettingsPatchRequest[] = [];
		const result = await applySettingsPatchWithRetry({
			scope: 'hotkey-site-mutation',
			domain: 'example.com',
			mutation: {
				type: 'upsert-binding',
				binding: {
					id: 'second',
					enabled: true,
					key: { code: 'KeyB', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
					action: 'volume_down',
				},
			},
		}, {
			async getSnapshot(forceRefresh) {
				if (forceRefresh) current = snapshot(2, ['first']);
				return current;
			},
			async sendPatch(request) {
				requests.push(request);
				if (request.expectedRevision === 1) {
					return rpcFailure('revision_conflict', 'Concurrent edit', true);
				}
				current = snapshot(3, ['first', 'second']);
				return rpcSuccess(current);
			},
		});

		expect(requests.map(({ expectedRevision }) => expectedRevision)).toEqual([1, 2]);
		expect(result.hotkeySettings.sites['example.com']?.bindings.map(({ id }) => id)).toEqual([
			'first',
			'second',
		]);
	});

});
