import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	SPECTRA_PROTOCOL_VERSION,
	compileEffectiveVolume,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	splitEffectiveVolume,
	type AudioConfig,
	type AudioSessionSnapshot,
} from '@nexus/contracts';
import { registerAudioV2Listener } from '../src/background/handlers/audio';
import {
	assembleInitialState,
	shouldApplyInitialPolicy,
} from '../src/content/core/initial-state';
import type { PolicyExecutorState } from '../src/content/types';

function config(patch: Partial<AudioConfig> = {}): AudioConfig {
	const merged = {
		...DEFAULT_AUDIO_CONFIG,
		...patch,
		eqValues: patch.eqValues ? [...patch.eqValues] : [...DEFAULT_AUDIO_CONFIG.eqValues],
	};
	const projection = patch.volume !== undefined
		&& patch.volumeBase === undefined
		&& patch.boost === undefined
		? splitEffectiveVolume(patch.volume)
		: { volumeBase: merged.volumeBase, boost: merged.boost };
	return {
		...merged,
		...projection,
		volume: compileEffectiveVolume(projection.volumeBase, projection.boost),
	};
}

function snapshot(
	tabId: number,
	overrides: Partial<AudioSessionSnapshot> = {},
): AudioSessionSnapshot {
	return {
		tabId,
		documentId: `document-${tabId}`,
		origin: 'https://media.example',
		generation: 12,
		desiredMode: 'capture',
		actualMode: 'capture',
		phase: 'active',
		configRevision: 3,
		actualConfig: config({ volume: 175 }),
		lastError: null,
		...overrides,
	};
}

function request(context: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.audio.session.current',
		payload: {},
		...context,
	};
}

describe('spectra.audio.session.current contract', () => {
	test('accepts only an empty sender-bound envelope and validates its response', () => {
		expect(isSpectraRequestEnvelope(request())).toBe(true);
		expect(isSpectraRequestEnvelope(request({ tabId: 42 }))).toBe(false);
		expect(isSpectraRequestEnvelope(request({ documentId: 'forged-document' }))).toBe(false);
		expect(isSpectraRequestEnvelope(request({ generation: 9 }))).toBe(false);
		expect(isSpectraRequestEnvelope({ ...request(), payload: { tabId: 42 } })).toBe(false);

		expect(isSpectraResponse(
			'spectra.audio.session.current',
			{ ok: true, data: snapshot(42) },
		)).toBe(true);
		expect(isSpectraResponse(
			'spectra.audio.session.current',
			{ ok: true, data: null },
		)).toBe(true);
	});

	test('accepts canonical WebAudio and rejects retired enum-style mode tokens', () => {
		expect(isSpectraResponse(
			'spectra.audio.session.current',
			{ ok: true, data: { ...snapshot(42), desiredMode: 'webaudio', actualMode: 'webaudio' } },
		)).toBe(true);
		for (const retiredMode of ['NATIVE_WEBAUDIO']) {
			const data = {
				...snapshot(42),
				desiredMode: retiredMode,
				actualMode: retiredMode,
			};
			expect(isSpectraResponse(
				'spectra.audio.session.current',
				{ ok: true, data },
			), retiredMode).toBe(false);
		}
	});
});

describe('current audio session background boundary', () => {
	test('derives a content identity and returns only an exact tab/document/origin match', async () => {
		const stored = new Map<string, AudioSessionSnapshot>([
			['spectra_audio_session_501', snapshot(501)],
			['spectra_audio_session_502', snapshot(999)],
			['spectra_audio_session_503', snapshot(503, { documentId: 'old-document' })],
			['spectra_audio_session_504', snapshot(504, { origin: 'https://old.example' })],
		]);
		const environment = installChrome(stored);
		try {
			registerAudioV2Listener();
			const listener = environment.listener();

			const exact = await dispatch(listener, request(), contentSender(501));
			expect(exact).toEqual({ ok: true, data: snapshot(501) });

			for (const tabId of [502, 503, 504]) {
				const response = await dispatch(listener, request(), contentSender(tabId));
				expect(response).toEqual({ ok: true, data: null });
			}

			const popup = await dispatch(listener, request(), { id: 'spectra-test' });
			expect(popup).toMatchObject({ ok: false, error: { code: 'forbidden' } });
			const external = await dispatch(listener, request(), {
				...contentSender(501),
				id: 'different-extension',
			});
			expect(external).toMatchObject({ ok: false, error: { code: 'forbidden' } });
		} finally {
			environment.restore();
		}
	});
});

describe('content session restore', () => {
	test('lets the exact background snapshot own generation and processing state', () => {
		const handoff: Partial<PolicyExecutorState> = {
			config: config({ volume: 180 }),
			appliedConfig: config({ volume: 170 }),
			activeMode: 'capture',
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'active',
			generation: 4,
			userHasInteracted: true,
		};
		const current = snapshot(42, {
			generation: 37,
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'error',
			lastError: { code: 'capture_retry', message: 'retry capture', retryable: true },
		});

		const restored = assembleInitialState({
			handoff,
			session: current,
			config: config({ volume: 190 }),
		});

		expect(restored.source).toBe('handoff');
		expect(restored.state).toMatchObject({
			config: expect.objectContaining({ volume: 180 }),
			appliedConfig: expect.objectContaining({ volume: 175 }),
			activeMode: 'capture',
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'error',
			generation: 37,
			lastError: 'retry capture',
			userHasInteracted: true,
		});
	});

	test('recovers a session without trusting a DOM handoff and disambiguates bypass policy modes', () => {
		const disabled = assembleInitialState({
			handoff: null,
			session: snapshot(61, {
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				actualConfig: config(),
			}),
			config: config(),
		});
		expect(disabled.state.desiredMode).toBe('bypass');
		expect(disabled.state.generation).toBe(12);

		const lite = assembleInitialState({
			handoff: null,
			session: snapshot(62, {
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				actualConfig: config({ volume: 80, volumeBase: 80 }),
			}),
			config: config({ volume: 80, volumeBase: 80 }),
		});
		expect(lite.state.desiredMode).toBe('bypass');
	});

	test('lets an explicit direct route retire a restored Capture session', () => {
		const restored = assembleInitialState({
			handoff: null,
			session: snapshot(65, {
				desiredMode: 'capture',
				actualMode: 'capture',
				phase: 'active',
				actualConfig: config({ volume: 180, volumeBase: 100, boost: 1.8 }),
			}),
			config: config({ volume: 180, volumeBase: 100, boost: 1.8 }),
			mediaRoute: 'direct',
		});

		expect(restored.state).toMatchObject({
			mediaRoute: 'direct',
			desiredMode: 'webaudio',
			actualMode: 'capture',
		});
		expect(shouldApplyInitialPolicy(restored.state, restored.source)).toBe(true);
	});

	test('retires recovered Capture that has neither DSP nor a re-admitted transient subscriber', () => {
		for (const phase of ['active', 'error'] as const) {
			const capture = assembleInitialState({
				handoff: null,
				session: snapshot(63, {
					desiredMode: 'bypass',
					actualMode: 'capture',
					phase,
				}),
				config: config(),
			});
			expect(capture.source).toBe('session');
			expect(capture.state.visualizerSubscribers.size).toBe(0);
			expect(shouldApplyInitialPolicy(capture.state, capture.source)).toBe(true);
		}

		const bypass = assembleInitialState({
			handoff: null,
			session: snapshot(64, {
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
			}),
			config: config(),
		});
		expect(bypass.source).toBe('session');
		expect(shouldApplyInitialPolicy(bypass.state, bypass.source)).toBe(true);
	});

	test('hydrates every same-document handoff without replaying its audio policy', () => {
		for (const actualMode of ['bypass', 'capture'] as const) {
			const handoff = assembleInitialState({
				handoff: {
					config: config({ volume: 180 }),
					appliedConfig: config({ volume: 180 }),
					actualMode,
					phase: actualMode === 'bypass' ? 'idle' : 'active',
					userHasInteracted: true,
				},
				session: null,
				config: null,
			});

			expect(handoff.source).toBe('handoff');
			expect(shouldApplyInitialPolicy(handoff.state, handoff.source)).toBe(false);
		}

		const fresh = assembleInitialState({ handoff: null, session: null, config: config() });
		expect(fresh.source).toBe('fresh');
		expect(shouldApplyInitialPolicy(fresh.state, fresh.source)).toBe(true);
	});
});

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void,
) => boolean | undefined;

function contentSender(tabId: number): chrome.runtime.MessageSender {
	return {
		id: 'spectra-test',
		documentId: `document-${tabId}`,
		frameId: 0,
		url: 'https://media.example/watch',
		tab: {
			id: tabId,
			url: 'https://media.example/watch',
		} as chrome.tabs.Tab,
	};
}

function dispatch(
	listener: RuntimeListener,
	message: unknown,
	sender: chrome.runtime.MessageSender,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Audio listener did not respond')), 1_000);
		listener(message, sender, (response) => {
			clearTimeout(timer);
			resolve(response);
		});
	});
}

function installChrome(stored: Map<string, AudioSessionSnapshot>): {
	listener(): RuntimeListener;
	restore(): void;
} {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
	let listener: RuntimeListener | undefined;
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				id: 'spectra-test',
				onMessage: {
					addListener(value: RuntimeListener) { listener = value; },
				},
				sendMessage: async () => undefined,
			},
			storage: {
				session: {
					async get(key: string) { return { [key]: stored.get(key) }; },
					async set() { /* read-only test */ },
					async remove() { /* read-only test */ },
				},
			},
		},
	});
	return {
		listener() {
			if (!listener) throw new Error('Audio listener was not registered');
			return listener;
		},
		restore() {
			if (descriptor) Object.defineProperty(globalThis, 'chrome', descriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		},
	};
}
