import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	compileEffectiveVolume,
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	SPECTRA_PROTOCOL_VERSION,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	createSpectraContentInvocationGrantedMessage,
	isAudioConfig,
	isAudioRuntimeStatus,
	isAudioSessionSnapshot,
	isSettingsPatchRequest,
	isSettingsSnapshot,
	isSpectraContentInvocationGrantedMessage,
	isSpectraEventEnvelope,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
	splitEffectiveVolume,
	toRemoteSessionView,
	type AudioConfig,
	type AudioRuntimeStatus,
	type AudioSessionSnapshot,
	type RemotePublicSession,
	type SettingsSnapshot,
	type SpectraEventEnvelope,
	type SpectraRequestEnvelope,
} from '@nexus/contracts';
import { withContentOSDMessages } from '../src/shared/i18n/content-osd';
import { createCaptureAdmission } from './helpers/capture-admission';

function legacyV2ContentGuardAccepts(value: ReturnType<typeof withContentOSDMessages>): boolean {
	const keys = Object.keys(value.osdMessages).sort();
	return keys.join(',') === 'corsAddedSafe,corsAutoAdded,corsCorrectedSafe,muted'
		&& Object.values(value.osdMessages).every((message) => (
			typeof message === 'string' && message.length > 0 && message.length <= 256
		));
}

function createAudioConfig(overrides: Partial<AudioConfig> = {}): AudioConfig {
	const merged = {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		...overrides,
	};
	const pair = overrides.volume !== undefined
		&& overrides.volumeBase === undefined
		&& overrides.boost === undefined
		? splitEffectiveVolume(overrides.volume)
		: { volumeBase: merged.volumeBase, boost: merged.boost };
	return {
		...merged,
		...pair,
		volume: compileEffectiveVolume(pair.volumeBase, pair.boost),
	};
}

function createRemoteSession(): RemotePublicSession {
	return {
		protocolVersion: 3,
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
		desiredMode: 'capture',
		actualMode: 'capture',
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
			slots: { slot_01: 'play_pause' },
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
	test('validates document media intent lifecycle without admitting arbitrary states', () => {
		const status = { bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION, runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION, ready: true, ownedSources: [] };
		for (const mediaIntentState of ['unset', 'retained', 'released']) {
			expect(isSpectraResponse('spectra.content.runtime.status', rpcSuccess({ ...status, mediaIntentState }))).toBe(true);
		}
		for (const mediaIntentState of [true, 'applied', null, 1]) {
			expect(isSpectraResponse('spectra.content.runtime.status', rpcSuccess({ ...status, mediaIntentState }))).toBe(false);
		}
	});
	test('accepts only complete, finite and implementable audio configs', () => {
		expect(isAudioConfig(createAudioConfig())).toBe(true);
		expect(isAudioConfig(createAudioConfig({ delay: -1 }))).toBe(false);
		expect(isAudioConfig(createAudioConfig({ speed: Number.NaN }))).toBe(false);
		expect(isAudioConfig(createAudioConfig({ eqValues: [0, 0] }))).toBe(false);
		expect(isAudioConfig({ ...createAudioConfig(), volume: 200 })).toBe(false);
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
		expect(isSettingsSnapshot({
			...snapshot,
			hotkeySettings: {
				...snapshot.hotkeySettings,
				slots: { slot_01: 'volume_up' },
			},
		})).toBe(false);
	});

	test('represents built-in chord collisions only as disabled snapshot evidence', () => {
		const reservedBinding = {
			id: 'reserved-default',
			enabled: false,
			key: {
				code: 'ArrowLeft',
				modifiers: { ctrl: false, alt: true, shift: false, meta: false },
			},
			action: 'play_pause',
			disabledReason: 'reserved_default_chord',
		} as const;
		const snapshot = createSettingsSnapshot();
		const withReserved = {
			...snapshot,
			hotkeySettings: {
				...snapshot.hotkeySettings,
				sites: {
					...snapshot.hotkeySettings.sites,
					'reserved.example': { enabled: true, bindings: [reservedBinding] },
				},
				disabledLegacyBindings: [reservedBinding],
			},
		};
		expect(isSettingsSnapshot(withReserved)).toBe(true);
		expect(isSettingsSnapshot({
			...withReserved,
			hotkeySettings: {
				...withReserved.hotkeySettings,
				sites: {
					...withReserved.hotkeySettings.sites,
					'reserved.example': {
						enabled: true,
						bindings: [{ ...reservedBinding, enabled: true }],
					},
				},
			},
		})).toBe(false);
		expect(isSettingsSnapshot({
			...withReserved,
			hotkeySettings: {
				...withReserved.hotkeySettings,
				disabledLegacyBindings: [{
					...reservedBinding,
					key: {
						...reservedBinding.key,
						code: 'KeyL',
					},
				}],
			},
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
		})).toBe(false);

		expect(isSettingsPatchRequest({
			expectedRevision: 7,
			patch: {
				scope: 'hotkey-site-mutation',
				domain: 'example.com',
				mutation: {
					type: 'upsert-binding',
					binding: {
						id: 'unsafe-url',
						enabled: true,
						key: {
							code: 'KeyU',
							modifiers: { ctrl: false, alt: false, shift: false, meta: false },
						},
						action: 'open_url',
						params: { url: 'javascript:alert(1)' },
					},
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
		for (const binding of [{
			id: 'reserved-enabled',
			enabled: true,
			key: {
				code: 'ArrowUp',
				modifiers: { ctrl: false, alt: true, shift: false, meta: false },
			},
			action: 'play_pause',
		}, {
			id: 'reserved-disabled',
			enabled: false,
			key: {
				code: 'KeyM',
				modifiers: { ctrl: false, alt: true, shift: false, meta: false },
			},
			action: 'play_pause',
			disabledReason: 'reserved_default_chord',
		}] as const) {
			expect(isSettingsPatchRequest({
				expectedRevision: 7,
				patch: {
					scope: 'hotkey-site-mutation',
					domain: 'music.example.com',
					mutation: { type: 'upsert-binding', binding },
				},
			})).toBe(false);
		}
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

	test('keeps the strict full-settings v2 ABI independent from site routes', () => {
		const snapshot = createSettingsSnapshot();
		expect(isSettingsSnapshot(snapshot)).toBe(true);
		expect(isSettingsSnapshot({
			...snapshot,
			mediaRoutes: {
				'example.com': { route: 'direct', source: 'user', updatedAt: 8 },
			},
		})).toBe(false);
		expect(isSettingsPatchRequest({
			expectedRevision: snapshot.revision,
			patch: { scope: 'media-route', domain: 'example.com', value: 'direct' },
		})).toBe(false);

		const entry = {
			domain: 'example.com',
			fingerprint: 'site:example.com',
			route: 'direct' as const,
			source: 'auto' as const,
			updatedAt: 8,
		};
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'registry-get',
			type: 'spectra.registry.get',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'registry-probe',
			type: 'spectra.registry.mark-probed',
			payload: { domain: 'Example.com.', fingerprint: 'site:example.com', route: 'direct' },
		})).toBe(true);
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({ entries: [entry] }))).toBe(true);
		const pathEntry = {
			...entry,
			pathPrefix: '/follow/live',
			fingerprint: 'site:example.com/follow/live',
			source: 'user' as const,
		};
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({ entries: [pathEntry] }))).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'route-rules-upsert',
			type: 'spectra.media-route.rules.upsert',
			payload: { domain: 'example.com', pathPrefix: '/follow/live', route: 'capture' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'route-rules-invalid-prefix',
			type: 'spectra.media-route.rules.upsert',
			payload: { domain: 'example.com', pathPrefix: '/follow/live/', route: 'capture' },
		})).toBe(false);
		expect(isSpectraResponse(
			'spectra.media-route.rules.get',
			rpcSuccess({ entries: [entry, pathEntry] }),
		)).toBe(true);
		expect(isSpectraResponse('spectra.registry.mark-probed', rpcSuccess({
			entries: [entry],
			entry,
			created: true,
		}))).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-route-get',
			type: 'spectra.audio.route.get',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-route-record',
			type: 'spectra.audio.route.record',
			payload: { route: 'capture', force: true },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'content-route-spoof',
			type: 'spectra.audio.route.record',
			payload: { domain: 'other.example', route: 'capture' },
		})).toBe(false);
		expect(isSpectraResponse(
			'spectra.audio.route.get',
			rpcSuccess({ mediaRoute: 'direct', source: 'user' }),
		)).toBe(true);
		expect(isSpectraResponse(
			'spectra.audio.route.record',
			rpcSuccess({ mediaRoute: 'auto', source: 'auto' }),
		)).toBe(false);
	});
});

describe('SPECTRA mapped v2 envelopes', () => {
	test('accepts only sender-bound, identity-bound default hotkey gestures', () => {
		for (const action of SPECTRA_DEFAULT_HOTKEY_ACTIONS) {
			for (const phase of ['press', 'release'] as const) {
				const request = {
					protocolVersion: SPECTRA_PROTOCOL_VERSION,
					requestId: `${action}:${phase}`,
					type: 'spectra.content.default-hotkey.trigger',
					payload: {
						action,
						phase,
						gesture: `default:${action}`,
						repeated: phase === 'release',
					},
				} as const;
				expect(isSpectraRequestEnvelope(request)).toBe(true);
				expect(isSpectraResponse(request.type, rpcSuccess({ accepted: true }))).toBe(true);
			}
		}
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'wrong-action',
			type: 'spectra.content.default-hotkey.trigger',
			payload: {
				action: 'gain_up',
				phase: 'press',
				gesture: 'default:wrong',
				repeated: false,
			},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'self-routed',
			tabId: 42,
			type: 'spectra.content.default-hotkey.trigger',
			payload: {
				action: 'speed_up',
				phase: 'press',
				gesture: 'default:self-routed',
				repeated: false,
			},
		})).toBe(false);
	});

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
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-batch',
			type: 'spectra.audio.visualizer.batch',
			payload: {
				subscriberId: 'popup-1',
				generation: 1,
				tabIds: [7, 42],
				captureTabId: 7,
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-cross-tab-capture',
			type: 'spectra.audio.visualizer.batch',
			payload: {
				subscriberId: 'popup-1',
				generation: 1,
				tabIds: [7],
				captureTabId: 42,
			},
		})).toBe(false);
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
			requestId: 'retired-legacy-theme',
			type: 'spectra.settings.patch',
			payload: {
				expectedRevision: 0,
				patch: { scope: 'legacy-theme', candidate: 'dark' },
			},
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-duplicate',
			type: 'spectra.audio.visualizer.batch',
			payload: {
				subscriberId: 'popup-1',
				generation: 1,
				tabIds: [7, 7],
				captureTabId: null,
			},
		})).toBe(false);
		const visualizerAdmission = createCaptureAdmission();
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-observation-without-capture-authority',
			tabId: 42,
			documentId: 'document-42',
			generation: 3,
			type: 'spectra.audio.visualizer.demand.set',
			payload: { subscriberId: 'popup-1', enabled: true },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-demand',
			tabId: 42,
			documentId: 'document-42',
			generation: 3,
			type: 'spectra.audio.visualizer.demand.set',
			payload: {
				subscriberId: 'popup-1',
				enabled: true,
				admission: visualizerAdmission,
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'visualizer-demand-forged-document',
			tabId: 42,
			documentId: 'document-forged',
			generation: 3,
			type: 'spectra.audio.visualizer.demand.set',
			payload: {
				subscriberId: 'popup-1',
				enabled: true,
				admission: visualizerAdmission,
			},
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
			payload: {
				enabled: true,
				config: createAudioConfig(),
				admission: createCaptureAdmission(),
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'capture-set-without-admission',
			type: 'spectra.audio.capture.set',
			generation: 4,
			payload: { enabled: true, config: createAudioConfig() },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'capture-stop',
			type: 'spectra.audio.capture.set',
			generation: 5,
			payload: { enabled: false, config: createAudioConfig(), requestContinuation: true },
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
				actualMode: 'capture',
				phase: 'starting',
				lastError: null,
				userInteracted: true,
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'publish-session-webaudio',
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
			documentId: 'document-42',
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
			generation: 8,
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
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			documentId: 'document-42',
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
		const hotkeyFeedbackEvent = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.hotkey.target.feedback',
			tabId: 42,
			payload: {
				action: 'volume_up',
				targetTabId: 7,
				targetTitle: 'Media',
				targetHostname: 'media.example',
				gesture: 'default:7',
				feedback: { kind: 'volume', value: 125, volumeState: 'capture' },
			},
		} as const;
		expect(isSpectraEventEnvelope(hotkeyFeedbackEvent)).toBe(true);
		expect(isSpectraEventEnvelope({
			...hotkeyFeedbackEvent,
			payload: {
				...hotkeyFeedbackEvent.payload,
				feedback: { kind: 'volume', value: 125, muted: false, capture: true },
			},
		})).toBe(false);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.hotkey.target.feedback',
			tabId: 42,
			payload: {
				action: 'speed_up',
				targetTabId: 7,
				targetTitle: 'Media',
				targetHostname: 'media.example',
				feedback: { kind: 'speed', value: 17 },
			},
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

	test('keeps the v2 producer acceptable to an already-running legacy Content guard', () => {
		const settings = createSettingsSnapshot();
		const produced = withContentOSDMessages(settings.globalSettings);
		expect(legacyV2ContentGuardAccepts(produced)).toBe(true);
		expect(isSpectraResponse('spectra.content.settings.get', rpcSuccess(produced))).toBe(true);
		expect(isSpectraEventEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.content.settings.changed',
			payload: produced,
		})).toBe(true);
		const incomplete = {
			...settings.globalSettings,
			osdMessages: { muted: 'MUTE' },
		};
		expect(legacyV2ContentGuardAccepts(incomplete as typeof produced)).toBe(false);
		expect(isSpectraResponse('spectra.content.settings.get', rpcSuccess(incomplete))).toBe(false);
		expect(isSpectraResponse('spectra.content.settings.get', rpcSuccess({
			...produced,
			osdMessages: { ...produced.osdMessages, corsAddedSafe: 7 },
		}))).toBe(false);
		expect(isSpectraResponse('spectra.content.settings.get', rpcSuccess({
			...produced,
			osdMessages: { ...produced.osdMessages, unexpected: 'copy' },
		}))).toBe(false);
	});

	test('validates request-specific success data and the shared error shape', () => {
		const settings = createSettingsSnapshot();
		const config = createAudioConfig({ volume: 150 });
		expect(isSpectraResponse('spectra.audio.config.get', rpcSuccess(config))).toBe(true);
		expect(isSpectraResponse('spectra.audio.config.get', rpcSuccess({
			config,
			mediaRoute: 'direct',
		}))).toBe(false);
		expect(isSpectraResponse('spectra.audio.policy.get', rpcSuccess({
			config,
			mediaRoute: 'direct',
		}))).toBe(true);
		expect(isSpectraResponse('spectra.audio.policy.get', rpcSuccess(config))).toBe(false);
		expect(isSpectraResponse('spectra.settings.get', rpcSuccess(settings))).toBe(true);
		expect(isSpectraResponse('spectra.settings.patch', rpcSuccess(settings))).toBe(true);
		expect(isSpectraResponse('spectra.settings.flush', rpcSuccess({ flushed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.settings.get', rpcSuccess(createAudioSession()))).toBe(false);
		expect(isSpectraResponse('spectra.audio.session.get', rpcSuccess(createAudioSession()))).toBe(true);
		expect(isSpectraResponse('spectra.audio.session.get', rpcSuccess(null))).toBe(true);
		expect(isSpectraResponse('spectra.audio.session.flush', rpcSuccess({ flushed: true }))).toBe(true);
		expect(isSpectraResponse('spectra.remote.session.create', rpcSuccess(createRemoteSession()))).toBe(true);
		// SP-30: a read path (.get) must return the secret-free view, never the
		// public session minted by .create. Both the producer (remote-service
		// getSessionOnce) and the validator agree on toRemoteSessionView.
		const remoteGetView = toRemoteSessionView(createRemoteSession());
		expect(isSpectraResponse('spectra.remote.session.get', rpcSuccess({
			session: remoteGetView,
			connected: remoteGetView.connected,
		}))).toBe(true);
		// The same payload carrying the pairing secret must be rejected: a status
		// query must never become a second way to obtain bearer pairing authority.
		expect(isSpectraResponse('spectra.remote.session.get', rpcSuccess(createRemoteSession()))).toBe(false);
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
		expect(isSpectraResponse('spectra.content.runtime.identity', rpcSuccess({
			documentId: 'document-42',
			frameId: 0,
		}))).toBe(true);
		expect(isSpectraResponse('spectra.content.runtime.identity', rpcSuccess({
			documentId: 'document-42',
			frameId: 1,
		}))).toBe(false);
		expect(isSpectraResponse('spectra.content.runtime.identity', rpcSuccess({
			documentId: 'document-42',
			frameId: 0,
			retag: true,
		}))).toBe(false);
		for (const invalidIdentity of [
			{ documentId: '', frameId: 0 },
			{ documentId: '   ', frameId: 0 },
			{ documentId: 'document-42' },
			{ frameId: 0 },
		]) {
			expect(isSpectraResponse(
				'spectra.content.runtime.identity',
				rpcSuccess(invalidIdentity),
			)).toBe(false);
		}
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'runtime-identity-empty',
			type: 'spectra.content.runtime.identity',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'runtime-identity-surplus',
			type: 'spectra.content.runtime.identity',
			payload: { documentId: 'forged' },
		})).toBe(false);
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
		expect(isSpectraResponse(
			'spectra.content.settings.get',
			rpcSuccess(withContentOSDMessages(settings.globalSettings)),
		)).toBe(true);
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
		// The media-tab list is a single complete answer: no coverage taxonomy to
		// report, no duplicate ids, and nothing left to converge later.
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [7, 42] }))).toBe(true);
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [7, 7] }))).toBe(false);
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [0] }))).toBe(false);
		expect(isSpectraResponse('spectra.tab.visible.list', rpcSuccess({ tabs: [], coverage: {} }))).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'legacy-media-report',
			type: 'spectra.tab.media.report',
			payload: { hasMediaElement: true, userInteracted: false },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'unknown-media-report-field',
			type: 'spectra.tab.media.report',
			payload: { hasMediaElement: false, userInteracted: false, hasSubframes: true },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'invalid-media-report-revision',
			type: 'spectra.tab.media.report',
			payload: { hasMediaElement: true, userInteracted: false, reportRevision: 0 },
		})).toBe(false);
		expect(isSpectraResponse('spectra.settings.patch', rpcFailure('revision_conflict', 'retry', true))).toBe(true);
		expect(isSpectraResponse('spectra.settings.patch', {
			ok: false,
			error: { code: 'invalid', message: '', retryable: false },
		})).toBe(false);
	});
});

describe('SPECTRA document invocation grant', () => {
	test('accepts only the canonical grant envelope', () => {
		const grant = createSpectraContentInvocationGrantedMessage();
		expect(isSpectraContentInvocationGrantedMessage(grant)).toBe(true);
		expect(isSpectraContentInvocationGrantedMessage({
			...grant,
			protocolVersion: SPECTRA_PROTOCOL_VERSION - 1,
		})).toBe(false);
		expect(isSpectraContentInvocationGrantedMessage({
			...grant,
			payload: { documentId: 'forged' },
		})).toBe(false);
		expect(isSpectraContentInvocationGrantedMessage({
			...grant,
			type: 'spectra.content.invocation.denied',
		})).toBe(false);
	});
});
