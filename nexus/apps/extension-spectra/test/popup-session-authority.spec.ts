import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { applyControlSnapshot, setupCardMessaging } from '../src/popup/card/messaging';
import { initialControlConfig, type CardInternalState } from '../src/popup/card/types';

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
) => boolean | undefined;

describe('Popup audio-session authority', () => {
	test('retries a current snapshot that still lacks playback until the native state is known', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const state = createState();
		state.controlSnapshotKnown = true;
		state.lifecycleSnapshotKnown = true;
		let reads = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			onMessage: { addListener() {}, removeListener() {} },
			sendMessage: async () => {
				reads += 1;
				return { ok: true, data: { ...state.controlSnapshot, fields: reads === 1 ? {} : {
					playing: { desired: false, actual: false, revision: 0, phase: 'applied', strategy: 'dom-native',
						coverage: 'active-target', controlled: false, lastError: null },
				} } };
			},
		} } });
		let finished!: () => void;
		const recovered = new Promise<void>((resolve) => { finished = resolve; });
		const cleanup = setupCardMessaging({ tabId: 17, state, render: () => {
			if (state.controlSnapshot?.fields.playing?.actual === false) finished();
		} });
		try {
			await Promise.race([recovered, Bun.sleep(1_000)]);
			expect(reads).toBe(2);
			expect(state.controlSnapshot?.fields.playing?.actual).toBe(false);
		} finally {
			cleanup();
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
	test('initializes fields only from ControlSnapshot actual state', () => {
		const config = initialControlConfig({
			tabId: 17,
			documentId: 'document-17',
			origin: 'https://media.example',
			generation: 2,
			revision: 3,
			activeMedia: null,
			activeVideo: null,
			fields: {
				volumeBase: {
					desired: 35,
					actual: 35,
					revision: 3,
					phase: 'applied',
					strategy: 'dom-native',
					coverage: 'active-target',
					controlled: false,
					lastError: null,
				},
			},
		});
		expect(config.volumeBase).toBe(35);
		expect(config.boost).toBe(1);
		expect(config.volume).toBe(35);
	});

	test('ignores capture predictions and updates mode only from AudioSessionSnapshot', () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: RuntimeListener | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: RuntimeListener) => { listener = next; },
						removeListener: () => undefined,
					},
				},
			},
		});
		const state = createState();
		let renders = 0;
		let cleanup = () => undefined;

		try {
			cleanup = setupCardMessaging({ tabId: 17, state, render: () => { renders += 1; } });
			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.capture.changed',
				tabId: 17,
				documentId: 'document-popup-capture',
				generation: 6,
				payload: {
					tabId: 17,
					generation: 6,
					phase: 'active',
					active: true,
					actualMode: 'capture',
					lastError: null,
				},
			}, {});
			listener?.({
				action: 'CAPTURE_STATE_CHANGE',
				payload: { tabId: 17, enabled: true },
			}, {});
			expect(state.actualMode).toBe('bypass');
			expect(state.phase).toBe('idle');
			expect(state.isCaptureActive).toBe(false);
			expect(renders).toBe(0);

			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.session.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 5,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 5,
					desiredMode: 'capture',
					actualMode: 'capture',
					phase: 'active',
					configRevision: 1,
					actualConfig: {
						...DEFAULT_AUDIO_CONFIG,
						volume: 137,
						volumeBase: 100,
						boost: 1.37,
					},
					lastError: null,
				},
			}, {});

			expect(state.actualMode).toBe('capture');
			expect(state.phase).toBe('active');
			expect(state.isCaptureActive).toBe(true);
			expect(state.config.volume).toBe(100);
			expect(renders).toBe(1);
		} finally {
			cleanup();
			if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('applies page-native control snapshots without collapsing Main volume and Boost', () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: RuntimeListener | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: RuntimeListener) => { listener = next; },
						removeListener: () => undefined,
					},
				},
			},
		});
		const state = createState();
		state.config.volumeBase = 50;
		state.config.boost = 2;
		state.config.volume = 100;
		state.stableConfig.volumeBase = 50;
		state.stableConfig.boost = 2;
		state.stableConfig.volume = 100;
		let cleanup = () => undefined;

		try {
			cleanup = setupCardMessaging({ tabId: 17, state, render: () => undefined });
			listener?.({
				protocolVersion: 2,
				type: 'spectra.control.snapshot.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 6,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 6,
					revision: 2,
					activeMedia: null,
					activeVideo: null,
					fields: {
						volumeBase: {
							desired: 40,
							actual: 40,
							revision: 2,
							phase: 'applied',
							strategy: 'dom-native',
							coverage: 'active-target',
							controlled: false,
							intentId: 'page-volume-2',
							lastError: null,
						},
					},
				},
			}, {});

			expect(state.config.volumeBase).toBe(40);
			expect(state.config.boost).toBe(2);
			expect(state.config.volume).toBe(80);
			expect(state.controlGeneration).toBe(6);
		} finally {
			cleanup();
			if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('keeps processor lifecycle owned by AudioSessionSnapshot after a DOM control update', () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: RuntimeListener | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: RuntimeListener) => { listener = next; },
						removeListener: () => undefined,
					},
				},
			},
		});
		const state = createState();
		let cleanup = () => undefined;

		try {
			cleanup = setupCardMessaging({ tabId: 17, state, render: () => undefined });
			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.session.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 6,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 6,
					desiredMode: 'capture',
					actualMode: 'capture',
					phase: 'active',
					configRevision: 4,
					actualConfig: { ...DEFAULT_AUDIO_CONFIG },
					lastError: null,
				},
			}, {});
			listener?.({
				protocolVersion: 2,
				type: 'spectra.control.snapshot.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 5,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 5,
					revision: 1,
					activeMedia: null,
					activeVideo: null,
					fields: {
						speed: {
							desired: 1.25,
							actual: 1.25,
							revision: 1,
							phase: 'applied',
							strategy: 'dom-native',
							coverage: 'active-target',
							controlled: false,
							lastError: null,
						},
					},
				},
			}, {});

			expect(state.config.speed).toBe(1.25);
			expect(state.actualMode).toBe('capture');
			expect(state.desiredMode).toBe('capture');
			expect(state.phase).toBe('active');
			expect(state.isCaptureActive).toBe(true);
			expect(state.audioGeneration).toBe(6);
			expect(state.controlGeneration).toBe(5);
		} finally {
			cleanup();
			if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('drops purple Capture state at a document boundary and ignores the delayed old session', () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: RuntimeListener | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: RuntimeListener) => { listener = next; },
						removeListener: () => undefined,
					},
				},
			},
		});
		const state = createState();
		state.actualMode = 'capture';
		state.desiredMode = 'capture';
		state.phase = 'active';
		state.isCaptureActive = true;
		state.audioDocumentId = 'document-17';
		state.audioOrigin = 'https://media.example';
		let cleanup = () => undefined;

		try {
			cleanup = setupCardMessaging({ tabId: 17, state, render: () => undefined });
			listener?.({
				protocolVersion: 2,
				type: 'spectra.control.snapshot.changed',
				tabId: 17,
				documentId: 'document-18',
				generation: 6,
				payload: {
					tabId: 17,
					documentId: 'document-18',
					origin: 'https://next.example',
					generation: 6,
					revision: 0,
					activeMedia: null,
					activeVideo: null,
					fields: {},
				},
			}, {});
			expect(state).toMatchObject({
				actualMode: 'bypass', phase: 'idle', isCaptureActive: false,
				audioDocumentId: null, audioOrigin: null, audioGeneration: -1,
			});

			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.session.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 5,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 5,
					desiredMode: 'capture',
					actualMode: 'capture',
					phase: 'active',
					configRevision: 9,
					actualConfig: { ...DEFAULT_AUDIO_CONFIG },
					lastError: null,
				},
			}, {});
			expect(state).toMatchObject({ actualMode: 'bypass', phase: 'idle', isCaptureActive: false });
		} finally {
			cleanup();
			if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test.each(['capture', 'bypass'] as const)('does not replay a carried processor field over a newer %s session', (mode) => {
		const state = createState();
		const previous = state.controlSnapshot;
		if (!previous) throw new Error('Expected current control snapshot');
		previous.fields.boost = {
			desired: mode === 'capture' ? 1 : 1.1,
			actual: mode === 'capture' ? 1 : 1.1,
			revision: 0,
			phase: 'applied',
			strategy: mode === 'capture' ? 'observe' : 'capture',
			coverage: 'full',
			controlled: mode !== 'capture',
			lastError: null,
		};
		state.actualMode = mode;
		state.desiredMode = mode;
		state.phase = mode === 'capture' ? 'active' : 'idle';
		state.isCaptureActive = mode === 'capture';
		state.audioDocumentId = previous.documentId;
		state.audioOrigin = previous.origin;
		state.audioGeneration = 6;

		expect(applyControlSnapshot(state, {
			...previous,
			revision: 1,
			fields: {
				...previous.fields,
				speed: { desired: 1.5, actual: 1.5, revision: 1, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: false, lastError: null },
			},
		}, () => undefined)).toBe(true);
		expect(state.actualMode).toBe(mode);
		expect(state.config.speed).toBe(1.5);
	});

	test('keeps a control-acknowledged Capture across native updates before the session event arrives', () => {
		const state = createState();
		const initial = state.controlSnapshot;
		if (!initial) throw new Error('Expected current control snapshot');
		const captured = {
			...initial,
			revision: 1,
			fields: {
				boost: { desired: 1.1, actual: 1.1, revision: 1, phase: 'applied' as const, strategy: 'capture' as const, coverage: 'full' as const, controlled: true, lastError: null },
			},
		};
		applyControlSnapshot(state, captured, () => undefined);
		expect(state.actualMode).toBe('capture');
		expect(state.audioDocumentId).toBeNull();
		applyControlSnapshot(state, { ...captured, revision: 2 }, () => undefined);
		expect(state.actualMode).toBe('capture');
	});

	test('preserves exact-runtime Capture while the first control snapshot becomes known', () => {
		const state = createState();
		const incoming = state.controlSnapshot;
		if (!incoming) throw new Error('Expected current control snapshot');
		state.controlSnapshot = null;
		state.controlSnapshotKnown = false;
		state.actualMode = 'capture';
		state.desiredMode = 'capture';
		state.phase = 'active';
		state.isCaptureActive = true;
		applyControlSnapshot(state, { ...incoming, revision: 1 }, () => undefined);
		expect(state.controlSnapshotKnown).toBe(true);
		expect(state).toMatchObject({ actualMode: 'capture', phase: 'active', isCaptureActive: true });
	});

	test('accepts a newer navigation generation and rejects a delayed old document', () => {
		const state = createState();
		state.controlGeneration = 5;
		state.controlRevision = 42;

		expect(applyControlSnapshot(state, {
			tabId: 17,
			documentId: 'document-18',
			origin: 'https://next.example',
			generation: 6,
			revision: 2,
			activeMedia: null,
			activeVideo: null,
			fields: {},
		}, () => undefined)).toBe(true);

		expect(state.controlGeneration).toBe(6);
		expect(state.controlRevision).toBe(2);
		expect(applyControlSnapshot(state, {
			tabId: 17,
			documentId: 'document-17',
			origin: 'https://media.example',
			generation: 5,
			revision: 99,
			activeMedia: null,
			activeVideo: null,
			fields: {},
		}, () => undefined)).toBe(false);
		expect(state.controlSnapshot?.documentId).toBe('document-18');
	});
});

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		stableConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		controlSnapshot: {
			tabId: 17,
			documentId: 'document-17',
			origin: 'https://media.example',
			generation: 5,
			revision: 0,
			activeMedia: null,
			activeVideo: null,
			fields: {},
		},
		isCaptureActive: false,
		userInteracted: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		controlGeneration: 5,
		controlRevision: 0,
		audioDocumentId: null,
		audioOrigin: null,
		audioGeneration: 5,
		audioConfigRevision: 0,
		lastError: null,
		draggingField: null,
	};
}
