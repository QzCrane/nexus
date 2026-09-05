import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_HOTKEY_SETTINGS,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	SPECTRA_PROTOCOL_VERSION,
	isSettingsUiPatchRequest,
	isSettingsUiSnapshot,
	isSpectraSettingsUiEventEnvelope,
	isSpectraSettingsUiResponse,
	type SettingsUiSnapshot,
} from '@nexus/contracts/ui-settings-runtime';
import {
	isSpectraFullSettingsEventEnvelope,
	isSpectraFullSettingsResponse,
} from '@nexus/contracts/full-settings-runtime';
import {
	createRevisionedSettingsClient,
	selectNewestRevisionedSnapshot,
} from '../src/shared/revisioned-settings-client';

function snapshot(revision: number): SettingsUiSnapshot {
	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision,
		globalSettings: { ...DEFAULT_GLOBAL_SETTINGS },
		hotkeySettings: {
			...DEFAULT_HOTKEY_SETTINGS,
			slots: { ...DEFAULT_HOTKEY_SETTINGS.slots },
			sites: { ...DEFAULT_HOTKEY_SETTINGS.sites },
			disabledLegacyBindings: [...(DEFAULT_HOTKEY_SETTINGS.disabledLegacyBindings ?? [])],
		},
	};
}

describe('canonical Options settings projection', () => {
	test('accepts only the four projected fields and rejects full audio state', () => {
		const projected = snapshot(3);
		expect(isSettingsUiSnapshot(projected)).toBe(true);
		expect(isSettingsUiSnapshot({ ...projected, audioSites: {} })).toBe(false);
		expect(isSettingsUiSnapshot({
		...projected,
		globalSettings: { ...projected.globalSettings, unexpected: true },
	})).toBe(false);
	});

	test('shares the full settings global/hotkey patch validators without accepting audio scopes', () => {
		expect(isSettingsUiPatchRequest({
			expectedRevision: 3,
		patch: { scope: 'global', changes: { themeMode: 'dark' } },
	})).toBe(true);
		expect(isSettingsUiPatchRequest({
			expectedRevision: 3,
			patch: { scope: 'hotkey-slots', changes: { slot_01: 'open_popup' } },
		})).toBe(true);
		expect(isSettingsUiPatchRequest({
			expectedRevision: 3,
			patch: { scope: 'hotkey-slots', changes: { slot_01: null } },
		})).toBe(true);
		expect(isSettingsUiPatchRequest({
			expectedRevision: 3,
			patch: { scope: 'hotkey-slots', changes: { slot_01: 'none' } },
		})).toBe(false);
	expect(isSettingsUiPatchRequest({
			expectedRevision: 3,
		patch: { scope: 'audio-site', domain: 'example.com', value: null },
		})).toBe(false);
	});

	test('keeps the full Popup ABI and the audio-free Options guard disjoint', () => {
		const projected = snapshot(3);
		const full = {
			...projected,
			audioSites: {},
			audioPresets: {},
			defaultPresetId: null,
		};
		const fullResponse = { ok: true as const, data: full };
		const uiResponse = { ok: true as const, data: projected };
		const fullEvent = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.settings.changed' as const,
			payload: full,
		};
		const uiEvent = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.settings.ui.changed' as const,
			payload: projected,
		};

		expect(isSpectraFullSettingsResponse('spectra.settings.get', fullResponse)).toBe(true);
		expect(isSpectraSettingsUiResponse('spectra.settings.ui.get', fullResponse)).toBe(false);
		expect(isSpectraFullSettingsEventEnvelope(fullEvent)).toBe(true);
		expect(isSpectraSettingsUiEventEnvelope(fullEvent)).toBe(false);
		expect(isSpectraSettingsUiEventEnvelope(uiEvent)).toBe(true);
		expect(isSpectraFullSettingsEventEnvelope(uiEvent)).toBe(false);
		expect(isSpectraSettingsUiResponse('spectra.settings.ui.get', uiResponse)).toBe(true);
	});
});

describe('generic revisioned settings client', () => {
	test('accepts only the newest revision and replays one conflict against a refreshed revision', async () => {
		const newest = snapshot(7);
		expect(selectNewestRevisionedSnapshot(newest, snapshot(6))).toBe(newest);

		let current = snapshot(1);
		let refreshes = 0;
		let patchAttempts = 0;
		const client = createRevisionedSettingsClient<SettingsUiSnapshot, { scope: 'global'; changes: { themeMode: 'dark' } }>({
			getSnapshot(forceRefresh = false) {
				if (forceRefresh) {
					refreshes += 1;
					current = snapshot(8);
				}
				return Promise.resolve(current);
			},
			sendPatch() {
			patchAttempts += 1;
			if (patchAttempts === 1) {
				return Promise.resolve({
					ok: false as const,
					error: { code: 'revision_conflict', message: 'stale', retryable: true },
				});
			}
			current = snapshot(9);
			return Promise.resolve({ ok: true as const, data: current });
		},
		});

		const observed: number[] = [];
		const unsubscribe = client.subscribe((value) => observed.push(value.revision));
		client.accept(newest);
		client.accept(snapshot(5));
		const result = await client.patch({ scope: 'global', changes: { themeMode: 'dark' } });
		await client.waitForIdle();
		unsubscribe();

		expect(result.revision).toBe(9);
		expect(patchAttempts).toBe(2);
		expect(refreshes).toBe(1);
		expect(observed).toEqual([7, 8, 9]);
	});
});
