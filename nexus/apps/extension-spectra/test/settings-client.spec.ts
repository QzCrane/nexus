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
import { applySettingsPatchWithRetry } from '../src/shared/settings-client';

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

	test('does not replay the one-release whole-site compatibility patch', async () => {
		let sendCount = 0;
		await expect(applySettingsPatchWithRetry({
			scope: 'hotkey-site',
			domain: 'example.com',
			value: { enabled: true, bindings: [] },
		}, {
			async getSnapshot() {
				return snapshot(4);
			},
			async sendPatch() {
				sendCount += 1;
				return rpcFailure('revision_conflict', 'Concurrent edit', true);
			},
		})).rejects.toThrow('revision_conflict');
		expect(sendCount).toBe(1);
	});

	test('replays the legacy theme consume intent after a concurrent v2 preference wins', async () => {
		let current = snapshot(1);
		const revisions: number[] = [];
		const result = await applySettingsPatchWithRetry({
			scope: 'legacy-theme',
			candidate: 'dark',
		}, {
			async getSnapshot(forceRefresh) {
				if (forceRefresh) {
					current = snapshot(2);
					current.globalSettings.themeMode = 'light';
				}
				return current;
			},
			async sendPatch(request) {
				revisions.push(request.expectedRevision);
				if (request.expectedRevision === 1) {
					return rpcFailure('revision_conflict', 'Modern preference was saved first', true);
				}
				return rpcSuccess(current);
			},
		});

		expect(revisions).toEqual([1, 2]);
		expect(result.globalSettings.themeMode).toBe('light');
	});
});
