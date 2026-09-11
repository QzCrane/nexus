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
	for (const dispose of disposers.splice(0)) dispose();
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
		tabId: 17, documentId, generation: 5,
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

const disposers: (() => void)[] = [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function navigation(documentId = 'document-18') {
	return { protocolVersion: 2, type: 'spectra.navigation.changed', tabId: 17, documentId, payload: { url: 'https://next.example/' } };
}

function fixture() {
	const runtime = installRuntimeListener();
	const cardState = state();
	const replaced = mock(() => undefined);
	const render = mock(() => undefined);
	let currentDocument = 'document-17';
	const getFrame = mock(async () => ({ documentId: currentDocument }));
	Object.assign(chrome, { webNavigation: { getFrame } });
	const dispose = setupCardMessaging({ tabId: 17, documentId: 'document-17', state: cardState, render, onDocumentReplaced: replaced });
	disposers.push(dispose);
	return { ...runtime, cardState, replaced, render, getFrame, dispose, navigate: () => { currentDocument = 'document-18'; } };
}

describe('Popup exact-document card projection', () => {
	test('continues rendering same-document updates through the single typed event hub', () => {
		const f = fixture();
		f.listener()(controlSnapshot(), {});
		expect(f.cardState.config.speed).toBe(1.25);
		expect(f.render).toHaveBeenCalledTimes(1);
		expect(f.replaced).not.toHaveBeenCalled();
		f.dispose();
		expect(f.removeListener).toHaveBeenCalledTimes(1);
	});

	test('retires once only after Chrome confirms a new top document', async () => {
		const f = fixture(); f.navigate();
		f.listener()(navigation(), {});
		f.listener()(navigation(), {});
		expect(f.replaced).not.toHaveBeenCalled();
		await flush();
		expect(f.getFrame).toHaveBeenCalledTimes(1);
		expect(f.replaced).toHaveBeenCalledTimes(1);
		expect(f.cardState).toMatchObject({ actualMode: 'bypass', desiredMode: 'bypass', phase: 'idle', isCaptureActive: false, audioDocumentId: null, audioGeneration: -1 });
		f.listener()(controlSnapshot('document-17', 9), {});
		f.listener()(navigation(), {});
		await flush();
		expect(f.replaced).toHaveBeenCalledTimes(1);
		expect(f.render).not.toHaveBeenCalled();
	});

	test('ignores child-frame, legacy and stale document claims', async () => {
		const f = fixture();
		f.listener()({ action: 'legacy-noop' }, { tab: { id: 17 } as chrome.tabs.Tab, documentId: 'child-frame', frameId: 1 });
		f.listener()(navigation(), { tab: { id: 17 } as chrome.tabs.Tab, documentId: 'child-frame', frameId: 1 });
		expect(f.getFrame).not.toHaveBeenCalled();
		f.listener()(navigation(), {});
		await flush();
		expect(f.replaced).not.toHaveBeenCalled();
		expect(f.cardState.actualMode).toBe('capture');
	});

	test('keeps main generation/revision admission before document replacement', async () => {
		const f = fixture(); f.navigate();
		const stale = controlSnapshot('document-18', 2);
		f.listener()(stale, {});
		await flush();
		expect(f.getFrame).not.toHaveBeenCalled();
		const fresh = { ...stale, generation: 6, payload: { ...stale.payload, generation: 6 } };
		f.listener()(fresh, {});
		await flush();
		expect(f.replaced).toHaveBeenCalledTimes(1);
	});

	test('disposal invalidates an in-flight document verification', async () => {
		const f = fixture(); f.navigate();
		f.listener()(navigation(), {}); f.dispose();
		await flush();
		expect(f.replaced).not.toHaveBeenCalled();
	});
});
