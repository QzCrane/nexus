import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { applyControlSnapshot, setupCardMessaging } from '../src/popup/card/messaging';
import { initialControlConfig, type CardInternalState } from '../src/popup/card/types';

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
) => boolean | undefined;

describe('Popup audio-session authority', () => {
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

		const initSource = readFileSync(resolve(import.meta.dir, '../src/popup/card/init.ts'), 'utf8');
		expect(initSource).not.toContain('.actualConfig');
		expect(initSource).not.toContain('status?.config');
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
		isDragging: false,
		draggingField: null,
	};
}
