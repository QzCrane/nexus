import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { setupCardMessaging } from '../src/popup/card/messaging';
import type { CardInternalState } from '../src/popup/card/types';

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
) => boolean | undefined;

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

function state(): CardInternalState {
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
		isCaptureActive: true,
		userInteracted: true,
		isRestrictedSite: true,
		actualMode: 'capture',
		desiredMode: 'capture',
		phase: 'active',
		audioDocumentId: 'document-17',
		audioOrigin: 'https://media.example',
		audioGeneration: 5,
		audioConfigRevision: 1,
		controlGeneration: 5,
		controlRevision: 0,
		lastError: null,
		isDragging: false,
		draggingField: null,
	};
}

function installRuntimeListener(): {
	listener: () => RuntimeListener;
	removeListener: ReturnType<typeof mock>;
} {
	let current: RuntimeListener | undefined;
	const removeListener = mock(() => undefined);
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				onMessage: {
					addListener: (listener: RuntimeListener) => { current = listener; },
					removeListener,
				},
			},
		},
	});
	return {
		listener: () => {
			if (!current) throw new Error('Popup card listener was not installed');
			return current;
		},
		removeListener,
	};
}

function controlSnapshot(documentId = 'document-17', revision = 1) {
	return {
		protocolVersion: 2,
		type: 'spectra.control.snapshot.changed',
		payload: {
			tabId: 17,
			documentId,
			origin: documentId === 'document-17' ? 'https://media.example' : 'https://next.example',
			generation: 5,
			revision,
			activeMedia: null,
			activeVideo: null,
			fields: {
				speed: {
					desired: 1.25,
					actual: 1.25,
					revision,
					phase: 'applied',
					strategy: 'dom-native',
					coverage: 'active-target',
					controlled: false,
					lastError: null,
				},
			},
		},
	};
}

describe('Popup exact-document card projection', () => {
	test('continues rendering same-document updates', () => {
		const runtime = installRuntimeListener();
		const cardState = state();
		let renders = 0;
		const replaced = mock(() => undefined);
		const dispose = setupCardMessaging({
			tabId: 17,
			documentId: 'document-17',
			state: cardState,
			render: () => { renders += 1; },
			onDocumentReplaced: replaced,
		});

		runtime.listener()(controlSnapshot(), {});
		expect(cardState.config.speed).toBe(1.25);
		expect(renders).toBe(1);
		expect(replaced).not.toHaveBeenCalled();
		dispose();
		expect(runtime.removeListener).toHaveBeenCalledTimes(1);
	});

	test('retires exactly once on a new top-document generation and ignores delayed messages', () => {
		const runtime = installRuntimeListener();
		const cardState = state();
		let renders = 0;
		const replaced = mock(() => undefined);
		setupCardMessaging({
			tabId: 17,
			documentId: 'document-17',
			state: cardState,
			render: () => { renders += 1; },
			onDocumentReplaced: replaced,
		});

		runtime.listener()({
			protocolVersion: 2,
			type: 'spectra.navigation.changed',
			tabId: 17,
			documentId: 'document-18',
			payload: { url: 'https://next.example/' },
		}, {});
		expect(replaced).toHaveBeenCalledTimes(1);
		expect(cardState).toMatchObject({
			actualMode: 'bypass',
			desiredMode: 'bypass',
			phase: 'idle',
			isCaptureActive: false,
			audioDocumentId: null,
			audioOrigin: null,
			audioGeneration: -1,
		});

		// Neither delayed old-document state nor another new-document signal may
		// mutate a projection that has already been retired for a reload.
		runtime.listener()(controlSnapshot('document-17', 9), {});
		runtime.listener()(controlSnapshot('document-18', 10), {});
		expect(replaced).toHaveBeenCalledTimes(1);
		expect(renders).toBe(0);
		expect(cardState.controlRevision).toBe(0);
	});

	test('treats a content sender from another document as the same replacement boundary', () => {
		const runtime = installRuntimeListener();
		const replaced = mock(() => undefined);
		const cardState = state();
		setupCardMessaging({
			tabId: 17,
			documentId: 'document-17',
			state: cardState,
			render: () => undefined,
			onDocumentReplaced: replaced,
		});

		runtime.listener()({ action: 'legacy-noop' }, {
			tab: { id: 17 } as chrome.tabs.Tab,
			documentId: 'document-18',
		});
		expect(replaced).toHaveBeenCalledTimes(1);
		expect(cardState.actualMode).toBe('bypass');
	});
});
