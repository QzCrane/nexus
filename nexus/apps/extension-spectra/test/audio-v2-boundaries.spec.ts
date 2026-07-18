import { describe, expect, mock, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
	type SpectraResponse,
} from '@nexus/contracts';
import { createMessageHandler, type MessageHandlerDeps } from '../src/content/logic/message-handler';

const CONFIG = {
	...DEFAULT_AUDIO_CONFIG,
	eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
};

function envelope(type: string, payload: unknown) {
	return {
		protocolVersion: 2,
		requestId: 'boundary-test',
		tabId: 42,
		type,
		payload,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('content audio v2 boundary', () => {
	test('keeps visualizer reads side-effect free and changes analyser ownership only through subscription intents', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});
		try {
			const setVisualizerSubscribed = mock(async () => true);
			const handler = createMessageHandler({
				state: { config: CONFIG },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
				getVisualizerData: () => new Uint8Array([1, 2, 3]),
				setVisualizerSubscribed,
			} as unknown as MessageHandlerDeps);
			let response: unknown;
			expect(handler(
				envelope('spectra.audio.visualizer.get', {}),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			)).toBe(false);
			expect(response).toEqual(rpcSuccess({ buffer: [1, 2, 3] }));
			expect(setVisualizerSubscribed).not.toHaveBeenCalled();

			expect(handler(
				envelope('spectra.audio.visualizer.subscription.set', { subscribed: true }),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			)).toBe(true);
			await Promise.resolve();
			expect(setVisualizerSubscribed).toHaveBeenCalledTimes(1);
			expect(setVisualizerSubscribed).toHaveBeenCalledWith(true);
			expect(response).toEqual(rpcSuccess({ subscribed: true }));
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('does not regress stable runtime state on same-generation capture intents', () => {
		const state = {
			config: CONFIG,
			appliedConfig: CONFIG,
			activeMode: null,
			desiredMode: null,
			actualMode: 'capture',
			phase: 'active',
			generation: 9,
			hasGesture: false,
			userHasInteracted: false,
			isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const handleMessage = mock(() => true);
		const handler = createMessageHandler({
			state,
			captureManager: {
				handleMessage,
				isPending: () => false,
				hasLocalRequest: () => false,
			} as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
			getVisualizerData: () => null,
			setVisualizerSubscribed: () => false,
		});
		const event = (generation: number, phase: 'starting' | 'active' | 'stopping' | 'idle' | 'error') => ({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			generation,
			payload: {
				tabId: 42,
				generation,
				phase,
				active: phase === 'active' || phase === 'stopping',
				actualMode: phase === 'active' || phase === 'stopping' ? 'capture' : 'bypass',
				lastError: phase === 'error'
					? { code: 'capture_error', message: 'denied', retryable: true }
					: null,
			},
		});

		handler(event(9, 'starting'), {}, () => undefined);
		expect(state.phase).toBe('active');

		handler(event(10, 'starting'), {}, () => undefined);
		expect(state.phase).toBe('starting');
		handler(event(10, 'active'), {}, () => undefined);
		expect(state.phase).toBe('active');
		handler(event(10, 'stopping'), {}, () => undefined);
		expect(state.phase).toBe('active');

		handler(event(11, 'stopping'), {}, () => undefined);
		expect(state.phase).toBe('stopping');
		handler(event(11, 'idle'), {}, () => undefined);
		expect(state.phase).toBe('idle');
		handler(event(11, 'starting'), {}, () => undefined);
		expect(state.phase).toBe('idle');
		expect(handleMessage).toHaveBeenCalledTimes(7);
	});

	test('restores desired WebAudio only after an external Capture stop ACK', async () => {
		const state = {
			config: CONFIG,
			appliedConfig: CONFIG,
			activeMode: 'NATIVE_WEBAUDIO',
			desiredMode: 'NATIVE_WEBAUDIO',
			actualMode: 'capture',
			phase: 'active',
			generation: 4,
			hasGesture: true,
			userHasInteracted: true,
			isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const applyState = mock(async () => undefined);
		const handler = createMessageHandler({
			state,
			policyExecutor: { applyState } as unknown as MessageHandlerDeps['policyExecutor'],
			captureManager: {
				handleMessage: () => true,
				isPending: () => false,
				hasLocalRequest: () => false,
			} as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
			getVisualizerData: () => null,
			setVisualizerSubscribed: () => false,
		});

		handler({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			generation: 5,
			payload: {
				tabId: 42,
				generation: 5,
				phase: 'idle',
				active: false,
				actualMode: 'bypass',
				lastError: null,
			},
		}, {}, () => undefined);
		await Promise.resolve();

		expect(state.actualMode).toBe('bypass');
		expect(applyState).toHaveBeenCalledWith({ modeIntent: true });
	});

	test('rejects malformed config before policy code and keeps status reads side-effect free', () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementsByTagName: () => [] },
		});

		try {
			const updateConfig = mock(() => undefined);
			const deps = {
				state: {
					config: CONFIG,
					activeMode: null,
					desiredMode: null,
					actualMode: 'bypass',
					phase: 'idle',
					generation: 0,
					hasGesture: false,
					userHasInteracted: false,
					isPopupOpen: false,
				},
				policyExecutor: { updateConfig },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
				getVisualizerData: () => null,
				setVisualizerSubscribed: () => false,
			} as unknown as MessageHandlerDeps;
			const handler = createMessageHandler(deps);
			let response: unknown;

			const malformed = handler(
				envelope('spectra.audio.runtime.configure', {
					config: { ...CONFIG, delay: -1 },
				}),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			);
			expect(malformed).toBe(false);
			expect(updateConfig).not.toHaveBeenCalled();
			expect(response).toEqual({
				ok: false,
				error: {
					code: 'invalid_request',
					message: 'Malformed audio runtime request',
					retryable: false,
				},
			});

			handler(
				envelope('spectra.audio.runtime.get', {}),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			);
			expect(updateConfig).not.toHaveBeenCalled();
			expect(isSpectraResponse('spectra.audio.runtime.get', response)).toBe(true);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
			if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
			else Reflect.deleteProperty(globalThis, 'document');
		}
	});

	test('delays runtime.configure ACK until persistence is accepted by background', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementsByTagName: () => [] },
		});

		try {
			const persistence = deferred<SpectraResponse<'spectra.audio.config.set'>>();
			const updateConfig = mock(() => persistence.promise);
			const deps = {
				state: {
					config: CONFIG,
					activeMode: null,
					desiredMode: null,
					actualMode: 'bypass',
					phase: 'idle',
					generation: 0,
					hasGesture: false,
					userHasInteracted: false,
					isPopupOpen: false,
				},
				policyExecutor: { updateConfig },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
				getVisualizerData: () => null,
				setVisualizerSubscribed: () => false,
			} as unknown as MessageHandlerDeps;
			const handler = createMessageHandler(deps);
			let response: unknown;

			const keepChannelOpen = handler(
				envelope('spectra.audio.runtime.configure', {
					config: { ...CONFIG, volume: 125 },
				}),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			);
			expect(keepChannelOpen).toBe(true);
			expect(response).toBeUndefined();
			expect(updateConfig).toHaveBeenCalledTimes(1);

			persistence.resolve(rpcSuccess({ saved: true as const }));
			await persistence.promise;
			await Promise.resolve();
			expect(isSpectraResponse('spectra.audio.runtime.configure', response)).toBe(true);
			expect(response).toMatchObject({ ok: true });
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
			if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
			else Reflect.deleteProperty(globalThis, 'document');
		}
	});

	test('forwards persistence failure instead of acknowledging runtime.configure', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});

		try {
			const updateConfig = mock(() => Promise.resolve(rpcFailure(
				'audio_config_persist_failed',
				'background unavailable',
				true,
			)));
			const deps = {
				state: { config: CONFIG },
				policyExecutor: { updateConfig },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
				getVisualizerData: () => null,
				setVisualizerSubscribed: () => false,
			} as unknown as MessageHandlerDeps;
			const handler = createMessageHandler(deps);
			let response: unknown;

			expect(handler(
				envelope('spectra.audio.runtime.configure', { config: CONFIG }),
				{ id: 'spectra-test' },
				(value) => { response = value; },
			)).toBe(true);
			expect(response).toBeUndefined();
			await Promise.resolve();
			expect(response).toEqual({
				ok: false,
				error: {
					code: 'audio_config_persist_failed',
					message: 'background unavailable',
					retryable: true,
				},
			});
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
