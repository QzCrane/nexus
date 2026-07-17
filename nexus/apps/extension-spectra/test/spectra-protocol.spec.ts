import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	isAudioConfig,
	isAudioRuntimeStatus,
	isAudioSessionSnapshot,
	isSettingsPatchRequest,
	isSettingsSnapshot,
	isSpectraEventEnvelope,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
	type AudioConfig,
	type AudioRuntimeStatus,
	type AudioSessionSnapshot,
	type RemotePublicSession,
	type SettingsSnapshot,
	type SpectraEventEnvelope,
	type SpectraRequestEnvelope,
} from '@nexus/contracts';

function createAudioConfig(overrides: Partial<AudioConfig> = {}): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		...overrides,
	};
}

function createRemoteSession(): RemotePublicSession {
	return {
		protocolVersion: 2,
		sessionId: 'A'.repeat(22),
		peerId: `spectra-${'b'.repeat(32)}`,
		secret: 'C'.repeat(22),
		createdAt: 1_700_000_000_000,
		pairingExpiresAt: 1_700_000_300_000,
		tabId: 42,
		connected: false,
	};
}

function createAudioSession(overrides: Partial<AudioSessionSnapshot> = {}): AudioSessionSnapshot {
	return {
		tabId: 42,
		documentId: 'document-42',
		origin: 'https://media.example.com',
		generation: 3,
		desiredMode: 'capture',
		actualMode: 'capture',
		phase: 'active',
		configRevision: 5,
		actualConfig: createAudioConfig({ volume: 125 }),
		lastError: null,
		...overrides,
	};
}

function createRuntimeStatus(overrides: Partial<AudioRuntimeStatus> = {}): AudioRuntimeStatus {
	return {
		config: createAudioConfig({ volume: 125 }),
		hasAudio: true,
		isPlaying: true,
		desiredMode: 'webaudio',
		actualMode: 'webaudio',
		phase: 'active',
		generation: 3,
		userInteracted: true,
		pausedAt: null,
		lastError: null,
		...overrides,
	};
}

function createSettingsSnapshot(): SettingsSnapshot {
	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision: 7,
		globalSettings: { ...DEFAULT_GLOBAL_SETTINGS, lang: 'zh-CN', themeMode: 'dark' },
		hotkeySettings: {
			slots: { volume_up: 'volume_up' },
			sites: {
				'example.com': {
					enabled: true,
					bindings: [{
						id: 'open-radio',
						enabled: true,
						key: {
							code: 'KeyR',
							modifiers: { ctrl: true, alt: false, shift: false, meta: false },
						},
						action: 'open_url',
						params: { url: 'https://radio.example.com/live' },
						conditions: { domains: ['example.com'], requireMedia: true },
					}],
				},
			},
			disabledLegacyBindings: [],
		},
		audioSites: {
			'example.com': { volume: 125, delay: 0 },
		},
		audioPresets: {
			Voice: {
				config: { mono: true },
				meta: { type: 'global', name: 'Voice', createdAt: 1, isDefault: true },
			},
		},
		defaultPresetId: 'Voice',
	};
}

describe('SPECTRA audio runtime guards', () => {
	test('accepts only complete, finite and implementable audio configs', () => {
		expect(isAudioConfig(createAudioConfig())).toBe(true);
		expect(isAudioConfig(createAudioConfig({ delay: -1 }))).toBe(false);
		expect(isAudioConfig(createAudioConfig({ speed: Number.NaN }))).toBe(false);
		expect(isAudioConfig(createAudioConfig({ eqValues: [0, 0] }))).toBe(false);
		expect(isAudioConfig({ ...createAudioConfig(), transientCommand: true })).toBe(false);
	});

	test('validates nested session state and canonical document identity', () => {
		expect(isAudioSessionSnapshot(createAudioSession())).toBe(true);
		expect(isAudioSessionSnapshot(createAudioSession({ origin: 'https://MEDIA.example.com' }))).toBe(false);
		expect(isAudioSessionSnapshot(createAudioSession({ generation: -1 }))).toBe(false);
		expect(isAudioSessionSnapshot(createAudioSession({ actualConfig: createAudioConfig({ pan: 2 }) }))).toBe(false);
		expect(isAudioSessionSnapshot(createAudioSession({
			lastError: { code: '', message: 'failed', retryable: false },
		}))).toBe(false);
	});

	test('validates the complete document runtime status without accepting legacy shapes', () => {
		expect(isAudioRuntimeStatus(createRuntimeStatus())).toBe(true);
		expect(isAudioRuntimeStatus({ ...createRuntimeStatus(), mode: 'CAPTURE' })).toBe(false);
		expect(isAudioRuntimeStatus(createRuntimeStatus({ generation: -1 }))).toBe(false);
		expect(isAudioRuntimeStatus(createRuntimeStatus({ pausedAt: 1.5 }))).toBe(false);
	});
});

describe('SPECTRA settings runtime guards', () => {
	test('validates complete settings and nested hotkey bindings', () => {
		const snapshot = createSettingsSnapshot();
		expect(isSettingsSnapshot(snapshot)).toBe(true);

		const invalidAction = structuredClone(snapshot) as unknown as Record<string, unknown>;
		const hotkeys = invalidAction.hotkeySettings as Record<string, unknown>;
		const sites = hotkeys.sites as Record<string, Record<string, unknown>>;
		const bindings = sites['example.com']?.bindings as Array<Record<string, unknown>>;
		if (bindings[0]) bindings[0].action = 'not_registered';
		expect(isSettingsSnapshot(invalidAction)).toBe(false);

		expect(isSettingsSnapshot({
			...snapshot,
			globalSettings: { ...snapshot.globalSettings, language: 'en-US' },
		})).toBe(false);
	});

	test('rejects unsafe URLs and unknown patch fields at the wire boundary', () => {
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site',
				domain: 'EXAMPLE.com.',
				value: { enabled: true, bindings: [] },
			},
		})).toBe(true);

		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site',
				domain: 'example.com',
				value: {
					enabled: true,
					bindings: [{
						id: 'unsafe-url',
						enabled: true,
						key: {
							code: 'KeyU',
							modifiers: { ctrl: false, alt: false, shift: false, meta: false },
						},
						action: 'open_url',
						params: { url: 'javascript:alert(1)' },
					}],
				},
			},
		})).toBe(false);

		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: { scope: 'global', changes: { language: 'en-US' } },
		})).toBe(false);
	});

	test('validates revisioned audio-site merge, replace, and removal patches', () => {
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'audio-site',
				domain: 'Music.Example.com.',
				value: { volume: 150, delay: 25 },
			},
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'audio-site',
				domain: 'music.example.com',
				value: { muted: true },
				mode: 'replace',
			},
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'audio-site',
				domain: 'music.example.com',
				value: null,
			},
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'audio-site',
				domain: 'music.example.com',
				value: { delay: -1 },
			},
		})).toBe(false);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'audio-site',
				domain: 'music.example.com',
				value: { volume: 150, toggleMute: true },
			},
		})).toBe(false);
	});

	test('validates atomic hotkey-site mutations and their binding payloads', () => {
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site-mutation',
				domain: 'Music.Example.com.',
				mutation: { type: 'ensure-site', enabled: true },
			},
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site-mutation',
				domain: 'music.example.com',
				mutation: {
					type: 'upsert-binding',
					binding: {
						id: 'safe-url',
						enabled: true,
						key: { code: 'KeyU', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
						action: 'open_url',
						params: { url: 'https://radio.example.com/live' },
					},
				},
			},
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site-mutation',
				domain: 'music.example.com',
				mutation: {
					type: 'upsert-binding',
					binding: {
						id: 'unsafe-url',
						enabled: true,
						key: { code: 'KeyU', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
						action: 'open_url',
						params: { url: 'javascript:alert(1)' },
					},
				},
			},
		})).toBe(false);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site-mutation',
				domain: 'music.example.com',
				mutation: { type: 'replace-site', value: { enabled: true, bindings: [] } },
			},
		})).toBe(false);
	});

	test('validates individual global preset and default preset patches', () => {
		const preset = {
			expectedRevision: 7,
			patch: {
				scope: 'audio-preset',
				name: 'Podcast clarity',
				value: {
					config: { volume: 135, compressor: true },
					meta: {
						type: 'global',
						name: 'Podcast clarity',
						createdAt: 1_700_000_000_000,
					},
				},
			},
		};
		expect(isSettingsPatchRequest(preset)).toBe(true);
		expect(isSettingsPatchRequest({
			...preset,
			patch: {
				...preset.patch,
				value: {
					...preset.patch.value,
					meta: { ...preset.patch.value.meta, name: 'different-key' },
				},
			},
		})).toBe(false);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: { scope: 'audio-preset', name: '__proto__', value: null },
		})).toBe(false);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: { scope: 'default-preset', value: 'Podcast clarity' },
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: { scope: 'default-preset', value: null },
		})).toBe(true);
		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: { scope: 'default-preset', value: 'x'.repeat(129) },
		})).toBe(false);
	});
});

describe('SPECTRA mapped v2 envelopes', () => {
	test('keeps request type and payload correlated at runtime', () => {
		const request: SpectraRequestEnvelope<'spectra.audio.session.get'> = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'request-42',
			type: 'spectra.audio.session.get',
			tabId: 42,
			payload: { tabId: 42 },
		};
		expect(isSpectraRequestEnvelope(request)).toBe(true);
		expect(isSpectraRequestEnvelope({ ...request, payload: {} })).toBe(false);
		expect(isSpectraRequestEnvelope({ ...request, tabId: 7 })).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'wrong-payload',
			type: 'spectra.settings.get',
			payload: { tabId: 42 },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'source-released',
			documentId: 'document-42',
			type: 'spectra.content.source.released',
			payload: {
				target: {
					frameId: 0,
					documentId: 'document-42',
					mediaId: 'media-42',
					sourceRevision: 2,
					kind: 'video',
				},
			},
		})).toBe(true);
		const targetChanged = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'target-changed',
			documentId: 'document-42',
			type: 'spectra.content.target.changed',
			payload: {
				target: {
					frameId: 0,
					documentId: 'document-42',
					mediaId: 'media-42',
					sourceRevision: 3,
					kind: 'video',
				},
			},
		} as const;
		expect(isSpectraRequestEnvelope(targetChanged)).toBe(true);
		expect(isSpectraRequestEnvelope({
			...targetChanged,
			documentId: 'document-forged',
		})).toBe(false);
		expect(isSpectraRequestEnvelope({ ...request, action: 'AUDIO_GET_STATUS' })).toBe(false);
		const activationPrompt = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'activation-prompt',
			tabId: 42,
			type: 'spectra.content.activation.prompt',
			payload: { field: 'pip', label: 'Click to enter Picture-in-Picture' },
		} as const;
		expect(isSpectraRequestEnvelope(activationPrompt)).toBe(true);
		expect(isSpectraRequestEnvelope({
			...activationPrompt,
			payload: { ...activationPrompt.payload, field: 'fullscreen' },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...activationPrompt,
			payload: { ...activationPrompt.payload, label: 'x'.repeat(257) },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-batch',
			type: 'spectra.audio.visualizer.batch',
			payload: { subscriberId: 'popup-1', generation: 1, tabIds: [7, 42] },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'screenshot-capture',
			documentId: 'document-42',
			generation: 2,
			type: 'spectra.screenshot.capture-visible',
			payload: {
				captureToken: 'capture-token-42',
				rect: { x: 0, y: 0, width: 640, height: 360, viewportWidth: 1280, viewportHeight: 720 },
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'screenshot-target-verify',
			documentId: 'document-42',
			generation: 2,
			type: 'spectra.screenshot.target.verify',
			payload: { captureToken: 'capture-token-42' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'remote-session',
			type: 'spectra.remote.session.get',
			tabId: 42,
			payload: { tabId: 42 },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'remote-session-missing-route',
			type: 'spectra.remote.session.get',
			payload: { tabId: 42 },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'user-script',
			type: 'spectra.user-script.execute',
			payload: { script: 'document.body.dataset.test = "ok"' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'flush-settings',
			type: 'spectra.settings.flush',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'legacy-theme',
			type: 'spectra.settings.patch',
			payload: {
				expectedRevision: 0,
				patch: { scope: 'legacy-theme', candidate: 'dark' },
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'invalid-legacy-theme',
			type: 'spectra.settings.patch',
			payload: {
				expectedRevision: 0,
				patch: { scope: 'legacy-theme', candidate: 'auto' },
			},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-duplicate',
			type: 'spectra.audio.visualizer.batch',
			payload: { subscriberId: 'popup-1', generation: 1, tabIds: [7, 7] },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'flush-tab-session',
			type: 'spectra.audio.session.flush',
			tabId: 42,
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'runtime-status',
			type: 'spectra.audio.runtime.get',
			tabId: 42,
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'runtime-status-no-route',
			type: 'spectra.audio.runtime.get',
			payload: {},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-settings',
			type: 'spectra.content.settings.get',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-inject',
			tabId: 42,
			type: 'spectra.content.inject',
			payload: { tabId: 42 },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-inject-route-mismatch',
			tabId: 7,
			type: 'spectra.content.inject',
			payload: { tabId: 42 },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'media-state',
			tabId: 42,
			type: 'spectra.media.state.get',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'media-state-no-route',
			type: 'spectra.media.state.get',
			payload: {},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'video-filter',
			tabId: 42,
			type: 'spectra.video.filter.set',
			payload: { brightness: 125, grayscale: true },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'video-filter-empty',
			tabId: 42,
			type: 'spectra.video.filter.set',
			payload: {},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'hotkey-trigger',
			tabId: 42,
			type: 'spectra.hotkey.trigger',
			payload: { action: 'volume_up' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'hotkey-trigger-invalid',
			tabId: 42,
			type: 'spectra.hotkey.trigger',
			payload: { action: 'pitch_up' },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'capture-set',
			type: 'spectra.audio.capture.set',
			generation: 4,
			payload: { enabled: true, config: createAudioConfig() },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'capture-set-no-generation',
			type: 'spectra.audio.capture.set',
			payload: { enabled: true, config: createAudioConfig() },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'publish-session',
			type: 'spectra.audio.session.publish',
			generation: 4,
			payload: {
				config: createAudioConfig(),
				desiredMode: 'capture',
				actualMode: 'webaudio',
				phase: 'starting',
				lastError: null,
				userInteracted: true,
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'toggle-pin',
			type: 'spectra.tab.pinned.toggle',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'open-view',
			type: 'spectra.ui.open',
			payload: { view: 'popup' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'open-unsafe-view',
			type: 'spectra.ui.open',
			payload: { view: 'devtools' },
		})).toBe(false);
	});

	test('validates event payloads and routing metadata together', () => {
		const session = createAudioSession();
		const event: SpectraEventEnvelope<'spectra.audio.session.changed'> = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.audio.session.changed',
			tabId: session.tabId,
			documentId: session.documentId,
			generation: session.generation,
			payload: session,
		};
		expect(isSpectraEventEnvelope(event)).toBe(true);
		expect(isSpectraEventEnvelope({ ...event, generation: event.generation + 1 })).toBe(false);
		expect(isSpectraEventEnvelope({ ...event, payload: createSettingsSnapshot() })).toBe(false);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			generation: 8,
			payload: {
				tabId: 42,
				generation: 8,
				phase: 'error',
				active: true,
				actualMode: 'capture',
				lastError: { code: 'stop_failed', message: 'still active', retryable: true },
			},
		})).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			generation: 7,
			payload: {
				tabId: 42,
				generation: 8,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				lastError: null,
			},
		})).toBe(false);

		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.settings.changed',
			payload: createSettingsSnapshot(),
		})).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.content.settings.changed',
			payload: {
				...createSettingsSnapshot().globalSettings,
				osdMessages: {
					muted: 'MUTE',
					corsAutoAdded: 'Added {domain}',
					corsAddedSafe: 'Safe {domain}',
					corsCorrectedSafe: 'Corrected {domain}',
				},
			},
		})).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.remote.session.changed',
			tabId: 42,
			payload: { tabId: 42, sessionId: 'A'.repeat(22), connected: true },
		})).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.remote.session.closed',
			tabId: 7,
			payload: { tabId: 42, sessionId: 'A'.repeat(22) },
		})).toBe(false);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.navigation.changed',
			tabId: 42,
			documentId: 'document-42',
			payload: { url: 'https://media.example/watch?v=two#chapter' },
		})).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.navigation.changed',
			tabId: 42,
			payload: { url: 'https://media.example/watch?v=two#chapter' },
		})).toBe(false);
	});

	test('validates request-specific success data and the shared error shape', () => {
		const settings = createSettingsSnapshot();
		expect(isSpectraResponse('spectra.settings.get', rpcSuccess(settings))).toBe(true);
		expect(isSpectraResponse('spectra.settings.patch', rpcSuccess(settings))).toBe(true);
		expect(isSpectraResponse('spectra.settings.flush', rpcSuccess({ flushed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.settings.get', rpcSuccess(createAudioSession()))).toBe(false);
		expect(isSpectraResponse('spectra.audio.session.get', rpcSuccess(createAudioSession()))).toBe(true);
		expect(isSpectraResponse('spectra.audio.session.get', rpcSuccess(null))).toBe(true);
		expect(isSpectraResponse('spectra.audio.session.flush', rpcSuccess({ flushed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.remote.session.create', rpcSuccess(createRemoteSession()))).toBe(true);
		expect(isSpectraResponse('spectra.remote.session.get', rpcSuccess({
			session: createRemoteSession(),
			connected: false,
		}))).toBe(true);
		expect(isSpectraResponse('spectra.remote.session.get', rpcSuccess({
			session: null,
			connected: true,
		}))).toBe(false);
		expect(isSpectraResponse('spectra.user-script.execute', rpcSuccess({ executed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.audio.runtime.get', rpcSuccess(createRuntimeStatus()))).toBe(true);
		expect(isSpectraResponse('spectra.content.runtime.status', rpcSuccess({
			bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
			runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
			ready: true,
			ownedSources: [{
				target: {
					frameId: 0,
					documentId: 'document-42',
					mediaId: 'media-42',
					sourceRevision: 2,
					kind: 'video',
				},
				markerCount: 3,
				abActive: true,
			}],
		}))).toBe(true);
		expect(isSpectraResponse('spectra.audio.runtime.get', rpcSuccess({
			...createRuntimeStatus(),
			mode: 'CAPTURE',
		}))).toBe(false);
		expect(isSpectraResponse('spectra.audio.config.set', rpcSuccess({ saved: true }))).toBe(true);
		expect(isSpectraResponse('spectra.audio.capture.set', rpcSuccess({
			tabId: 42,
			generation: 9,
			phase: 'active',
			active: true,
			actualMode: 'capture',
			lastError: null,
		}))).toBe(true);
		expect(isSpectraResponse('spectra.tab.pinned.toggle', rpcSuccess({ pinned: true }))).toBe(true);
		expect(isSpectraResponse('spectra.tab.muted.toggle', rpcSuccess({ muted: false }))).toBe(true);
		expect(isSpectraResponse('spectra.ui.open', rpcSuccess({ opened: true }))).toBe(true);
		expect(isSpectraResponse('spectra.content.activation.prompt', rpcSuccess({ armed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.content.activation.prompt', rpcSuccess({ armed: false }))).toBe(false);
		expect(isSpectraResponse('spectra.audio.visualizer.batch', rpcSuccess({
			subscriberId: 'popup-1',
			generation: 1,
			frames: { '7': [0, 128, 255], '42': null },
		}))).toBe(true);
		expect(isSpectraResponse('spectra.audio.visualizer.batch', rpcSuccess({
			subscriberId: 'popup-1',
			generation: 1,
			frames: { '7': [256] },
		}))).toBe(false);
		expect(isSpectraResponse('spectra.content.settings.get', rpcSuccess({
			...settings.globalSettings,
			osdMessages: {
				muted: 'MUTE',
				corsAutoAdded: 'Added {domain}',
				corsAddedSafe: 'Safe {domain}',
				corsCorrectedSafe: 'Corrected {domain}',
			},
		}))).toBe(true);
		expect(isSpectraResponse('spectra.media.state.get', rpcSuccess({
			playing: true,
			speed: 1.25,
			pipActive: false,
			preservePitch: true,
		}))).toBe(true);
		expect(isSpectraResponse('spectra.video.screenshot', rpcSuccess({
			dataUrl: 'javascript:alert(1)',
		}))).toBe(false);
		expect(isSpectraResponse(
			'spectra.screenshot.target.verify',
			rpcSuccess({ valid: true }),
		)).toBe(true);
		expect(isSpectraResponse(
			'spectra.screenshot.target.verify',
			rpcSuccess({ valid: false }),
		)).toBe(false);
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [7, 42] }))).toBe(true);
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [7, 7] }))).toBe(false);
		expect(isSpectraResponse('spectra.settings.patch', rpcFailure('revision_conflict', 'retry', true))).toBe(true);
		expect(isSpectraResponse('spectra.settings.patch', {
			ok: false,
			error: { code: 'invalid', message: '', retryable: false },
		})).toBe(false);
	});
});
