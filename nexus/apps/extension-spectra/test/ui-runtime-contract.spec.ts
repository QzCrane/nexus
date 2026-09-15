import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	isSpectraEventEnvelope,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
	type AudioRuntimeStatus,
	type AudioSessionSnapshot,
	type ControlOperationAck,
	type ControlSnapshot,
	type RemotePublicSession,
	type SettingsSnapshot,
	type SpectraEventEnvelope,
	type SpectraRequestType,
} from '@nexus/contracts';
import {
	SPECTRA_UI_EVENT_TYPES,
	SPECTRA_UI_REQUEST_TYPES,
	isSpectraUiEventEnvelope,
	isSpectraUiEventType,
	isSpectraUiRequestType,
	isSpectraUiResponse,
	type SpectraUiEventType,
	type SpectraUiRequestType,
} from '@nexus/contracts/ui-runtime';
import {
	SPECTRA_SETTINGS_UI_REQUEST_TYPES,
	isSpectraSettingsUiEventEnvelope,
	isSpectraSettingsUiRequestType,
	isSpectraSettingsUiResponse,
	type SettingsUiSnapshot,
} from '@nexus/contracts/ui-settings-runtime';

const tabId = 42;
const documentId = 'document-42';
const generation = 3;

function createControlSnapshot(): ControlSnapshot {
	return {
		tabId,
		documentId,
		origin: 'https://media.example.com',
		generation,
		revision: 5,
		activeMedia: null,
		activeVideo: null,
		fields: {},
	};
}

function createOperationAck(): ControlOperationAck {
	return {
		operationId: 'operation-42',
		tabId,
		documentId,
		generation,
		revision: 6,
		target: null,
		operation: 'show-info',
		strategy: 'observe',
		coverage: 'full',
		fields: {},
		result: { shown: true },
	};
}

function createPageNativeVolumeAck(): ControlOperationAck<'effective-volume'> {
	return {
		operationId: 'operation-page-native-volume',
		tabId,
		documentId,
		generation,
		revision: 6,
		target: null,
		operation: 'effective-volume',
		strategy: 'extension-state',
		coverage: 'active-target',
		fields: {
			volumeBase: {
				desired: 40,
				actual: 40,
				revision: 6,
				phase: 'applied',
				strategy: 'page-native',
				coverage: 'active-target',
				controlled: false,
				lastError: null,
			},
		},
		result: { effectiveVolume: 40, volumeBase: 40, boost: 1 },
	};
}

function createSettingsSnapshot(): SettingsSnapshot {
	return {
		schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION,
		revision: 7,
		globalSettings: { ...DEFAULT_GLOBAL_SETTINGS },
		hotkeySettings: { slots: {}, sites: {}, disabledLegacyBindings: [] },
		audioSites: {},
		audioPresets: {},
		defaultPresetId: null,
	};
}

function createSettingsUiSnapshot(): SettingsUiSnapshot {
	const snapshot = createSettingsSnapshot();
	return {
		schemaVersion: snapshot.schemaVersion,
		revision: snapshot.revision,
		globalSettings: snapshot.globalSettings,
		hotkeySettings: snapshot.hotkeySettings,
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
		tabId,
		connected: false,
	};
}

function createAudioSession(): AudioSessionSnapshot {
	return {
		tabId,
		documentId,
		origin: 'https://media.example.com',
		generation,
		desiredMode: 'capture',
		actualMode: 'capture',
		phase: 'active',
		configRevision: 4,
		actualConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		lastError: null,
	};
}

function createAudioRuntime(): AudioRuntimeStatus {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		hasAudio: true,
		isPlaying: true,
		desiredMode: 'capture',
		actualMode: 'capture',
		phase: 'active',
		generation,
		userInteracted: true,
		pausedAt: null,
		lastError: null,
	};
}

function createUiSuccessData(): Record<SpectraUiRequestType, unknown> {
	const snapshot = createControlSnapshot();
	const remoteSession = createRemoteSession();
	return {
		'spectra.content.runtime.ensure': {
			documentId,
			runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
			ready: true,
		},
		'spectra.content.runtime.release': { accepted: true },
		'spectra.control.snapshot.get': snapshot,
		'spectra.control.intent.submit': {
			intentId: 'intent-42',
			tabId,
			documentId,
			generation,
			revision: 6,
			target: null,
			fields: {},
		},
		'spectra.control.operation.submit': createOperationAck(),
		'spectra.settings.ui.get': createSettingsUiSnapshot(),
		'spectra.settings.ui.patch': createSettingsUiSnapshot(),
		'spectra.settings.flush': { flushed: true },
		'spectra.audio.session.flush': { flushed: true },
		'spectra.hotkey-target.get': { tabId },
		'spectra.hotkey-target.set': { tabId },
		'spectra.remote.session.get': { session: remoteSession, connected: false },
		'spectra.remote.session.create': remoteSession,
		'spectra.remote.session.close': { closed: true },
		'spectra.audio.session.get': createAudioSession(),
		'spectra.audio.runtime.get': createAudioRuntime(),
		'spectra.audio.visualizer.batch': {
			subscriberId: 'popup-42',
			generation,
			frames: { '42': [0, 128, 255] },
		},
		'spectra.tab.visible.list': {
			tabs: [7, tabId],
			coverage: { status: 'complete', total: 2, examined: 2, pending: 0, failed: 0, denied: 0, stale: 0, unknown: 0 },
		},
		'spectra.tab.visible.settle': {
			tabs: [7, tabId],
			coverage: { status: 'complete', total: 2, examined: 2, pending: 0, failed: 0, denied: 0, stale: 0, unknown: 0 },
		},
	};
}

function createUiEvents(): Record<SpectraUiEventType, SpectraEventEnvelope> {
	const snapshot = createControlSnapshot();
	const session = createAudioSession();
	return {
		'spectra.navigation.changed': { protocolVersion: SPECTRA_PROTOCOL_VERSION, type: 'spectra.navigation.changed', tabId, documentId, payload: { url: 'https://media.example.com/watch?v=two' } },
		'spectra.control.snapshot.changed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.control.snapshot.changed',
			tabId,
			documentId,
			generation,
			payload: snapshot,
		},
		'spectra.settings.ui.changed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.settings.ui.changed',
			payload: createSettingsUiSnapshot(),
		},
		'spectra.remote.session.changed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.remote.session.changed',
			tabId,
			payload: { tabId, sessionId: 'A'.repeat(22), connected: true },
		},
		'spectra.remote.session.closed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.remote.session.closed',
			tabId,
			payload: { tabId, sessionId: 'A'.repeat(22) },
		},
		'spectra.audio.session.changed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.audio.session.changed',
			tabId,
			documentId,
			generation,
			payload: session,
		},
		'spectra.audio.capture.changed': {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.audio.capture.changed',
			tabId,
			documentId,
			generation,
			payload: {
				tabId,
				generation,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				lastError: null,
			},
		},
	};
}

describe('restricted extension UI protocol facade', () => {
	test('owns one unique closed request and event allowlist', () => {
		expect(SPECTRA_UI_REQUEST_TYPES).toHaveLength(19);
		expect(new Set(SPECTRA_UI_REQUEST_TYPES).size).toBe(SPECTRA_UI_REQUEST_TYPES.length);
		expect(SPECTRA_UI_EVENT_TYPES).toHaveLength(7);
		expect(new Set(SPECTRA_UI_EVENT_TYPES).size).toBe(SPECTRA_UI_EVENT_TYPES.length);
		for (const type of SPECTRA_UI_REQUEST_TYPES) expect(isSpectraUiRequestType(type)).toBe(true);
		for (const type of SPECTRA_UI_EVENT_TYPES) expect(isSpectraUiEventType(type)).toBe(true);
		expect(isSpectraUiRequestType('spectra.audio.capture.set')).toBe(false);
		expect(isSpectraUiEventType('spectra.content.settings.changed')).toBe(false);
	});

	test('keeps the Options facade narrow and canonically equivalent', () => {
		expect(SPECTRA_SETTINGS_UI_REQUEST_TYPES).toHaveLength(5);
		expect(new Set(SPECTRA_SETTINGS_UI_REQUEST_TYPES).size)
			.toBe(SPECTRA_SETTINGS_UI_REQUEST_TYPES.length);
		const successData = createUiSuccessData();
		for (const type of SPECTRA_SETTINGS_UI_REQUEST_TYPES) {
			expect(isSpectraSettingsUiRequestType(type)).toBe(true);
			const response = rpcSuccess(successData[type]);
			expect(isSpectraResponse(type, response), `${type} canonical settings success`).toBe(true);
			expect(isSpectraSettingsUiResponse(type, response), `${type} settings UI success`).toBe(true);
		}
		expect(isSpectraSettingsUiRequestType('spectra.control.snapshot.get')).toBe(false);
		expect(isSpectraSettingsUiResponse(
			'spectra.control.snapshot.get',
			rpcSuccess(createControlSnapshot()),
		)).toBe(false);

		const settingsEvent = createUiEvents()['spectra.settings.ui.changed'];
		expect(isSpectraSettingsUiEventEnvelope(settingsEvent)).toBe(true);
		expect(isSpectraSettingsUiEventEnvelope(
			createUiEvents()['spectra.control.snapshot.changed'],
		)).toBe(false);
	});

	test('accepts every canonical UI success response and rejects the same field mutations', () => {
		const successData = createUiSuccessData();
		for (const type of SPECTRA_UI_REQUEST_TYPES) {
			const response = rpcSuccess(successData[type]);
			expect(isSpectraResponse(type, response), `${type} canonical success`).toBe(true);
			expect(isSpectraUiResponse(type, response), `${type} UI success`).toBe(true);

			const mutatedData = structuredClone(successData[type]) as Record<string, unknown>;
			mutatedData.__unexpected = true;
			const mutated = rpcSuccess(mutatedData);
			expect(isSpectraResponse(type, mutated), `${type} canonical mutation`).toBe(false);
			expect(isSpectraUiResponse(type, mutated), `${type} UI mutation`).toBe(false);
		}
	});

	test('accepts a legacy v2 tab inventory only as a response without coverage evidence', () => {
		const response = rpcSuccess({ tabs: [7, tabId] });
		expect(isSpectraResponse('spectra.tab.visible.list', response)).toBe(true);
		expect(isSpectraUiResponse('spectra.tab.visible.list', response)).toBe(true);
	});

	test('accepts page-native volume acknowledgements in the focused Popup guard', () => {
		const response = rpcSuccess(createPageNativeVolumeAck());
		expect(isSpectraResponse('spectra.control.operation.submit', response)).toBe(true);
		expect(isSpectraUiResponse('spectra.control.operation.submit', response)).toBe(true);
	});

	test('accepts a proven Media WebAudio processor ACK in the focused Popup guard', () => {
		const snapshot = createControlSnapshot();
		snapshot.fields.boost = {
			desired: 2,
			actual: 2,
			revision: 2,
			phase: 'applied',
			strategy: 'media-webaudio',
			coverage: 'full',
			controlled: true,
			lastError: null,
		};
		const response = rpcSuccess(snapshot);
		expect(isSpectraResponse('spectra.control.snapshot.get', response)).toBe(true);
		expect(isSpectraUiResponse('spectra.control.snapshot.get', response)).toBe(true);
	});

	test('keeps shared errors canonical but rejects errors for non-UI request types', () => {
		const failure = rpcFailure('runtime_unavailable', 'retry later', true);
		for (const type of SPECTRA_UI_REQUEST_TYPES) {
			expect(isSpectraResponse(type, failure), `${type} canonical error`).toBe(true);
			expect(isSpectraUiResponse(type, failure), `${type} UI error`).toBe(true);
		}

		const internalType: SpectraRequestType = 'spectra.audio.capture.set';
		expect(isSpectraResponse(internalType, failure)).toBe(true);
		expect(isSpectraUiResponse(internalType, failure)).toBe(false);
	});

	test('rejects capability, result, revision and sample-shape drift exactly like canonical guards', () => {
		const invalidSnapshot = createControlSnapshot();
		invalidSnapshot.fields.volumeBase = {
			desired: 50,
			actual: 50,
			revision: 1,
			phase: 'applied',
			strategy: 'capture',
			coverage: 'full',
			controlled: true,
			lastError: null,
		};
		const invalidCases: Array<[SpectraUiRequestType, unknown]> = [
			['spectra.content.runtime.ensure', rpcSuccess({
				documentId,
				runtimeRevision: 'not-a-runtime-revision',
				ready: true,
			})],
			['spectra.control.snapshot.get', rpcSuccess(invalidSnapshot)],
			['spectra.control.operation.submit', rpcSuccess({
				...createOperationAck(),
				strategy: 'capture',
			})],
			['spectra.control.operation.submit', rpcSuccess({
				...createOperationAck(),
				result: {},
			})],
			['spectra.audio.session.get', rpcSuccess({
				...createAudioSession(),
				desiredMode: 'NATIVE_WEBAUDIO',
				actualMode: 'NATIVE_WEBAUDIO',
			})],
			['spectra.audio.runtime.get', rpcSuccess({
				...createAudioRuntime(),
				desiredMode: 'NATIVE_WEBAUDIO',
				actualMode: 'NATIVE_WEBAUDIO',
			})],
			['spectra.audio.visualizer.batch', rpcSuccess({
				subscriberId: 'popup-42',
				generation,
				frames: { '42': [-1, 0, 1] },
			})],
		];
		for (const [type, response] of invalidCases) {
			expect(isSpectraResponse(type, response), `${type} canonical drift`).toBe(false);
			expect(isSpectraUiResponse(type, response), `${type} UI drift`).toBe(false);
		}
	});

	test('matches canonical validation for every allowed event and rejects payload mutations', () => {
		const events = createUiEvents();
		for (const type of SPECTRA_UI_EVENT_TYPES) {
			const event = events[type];
			expect(isSpectraEventEnvelope(event), `${type} canonical event`).toBe(true);
			expect(isSpectraUiEventEnvelope(event), `${type} UI event`).toBe(true);

			const mutated = structuredClone(event) as unknown as {
				payload: Record<string, unknown>;
			};
			mutated.payload.__unexpected = true;
			expect(isSpectraEventEnvelope(mutated), `${type} canonical mutation`).toBe(false);
			expect(isSpectraUiEventEnvelope(mutated), `${type} UI mutation`).toBe(false);
		}
	});

	test('rejects canonical internal events that are outside the UI allowlist', () => {
		const settings = createSettingsSnapshot();
		const internalEvents: SpectraEventEnvelope[] = [
			{
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				type: 'spectra.content.settings.changed',
				payload: {
					...settings.globalSettings,
					osdMessages: {
						muted: 'MUTE',
						corsAutoAdded: 'Added {domain}',
						corsAddedSafe: 'Safe {domain}',
						corsCorrectedSafe: 'Corrected {domain}',
					},
				},
			},
			{
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				type: 'spectra.hotkeys.changed',
				payload: settings.hotkeySettings,
			},
		];
		for (const event of internalEvents) {
			expect(isSpectraEventEnvelope(event)).toBe(true);
			expect(isSpectraUiEventEnvelope(event)).toBe(false);
		}
	});

	test('uses the canonical remote-session token boundary for UI events', () => {
		const event = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.remote.session.changed',
			tabId,
			payload: { tabId, sessionId: 'bounded-but-not-a-token', connected: true },
		} as const;
		expect(isSpectraEventEnvelope(event)).toBe(false);
		expect(isSpectraUiEventEnvelope(event)).toBe(false);
	});
});
