import { describe, expect, mock, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
	type SpectraResponse,
} from '@nexus/contracts';
import { createMessageHandler, type MessageHandlerDeps } from '../src/content/logic/message-handler';
import { DocumentRuntimeContext } from '../src/content/core/content-runtime-context';
import { createCaptureAdmission } from './helpers/capture-admission';

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
	test('returns only an acknowledged page WebAudio analyser frame for the current document', () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});
		try {
			const state = {
				config: CONFIG,
				actualMode: 'webaudio',
				phase: 'active',
				visualizerSubscribers: new Set(['popup-visualizer-a']),
			} as MessageHandlerDeps['state'];
			const getVisualizerData = mock(() => new Uint8Array([0, 64, 255]));
			const handler = createMessageHandler({
				state,
				runtimeContext: new DocumentRuntimeContext({ documentId: 'document-42', frameId: 0 }),
				captureManager: { handleMessage: mock(() => false) },
				audioController: { getVisualizerData },
				settingsManager: {},
			} as unknown as MessageHandlerDeps);
			let response: unknown;
			expect(handler(
				{ ...envelope('spectra.audio.visualizer.get', {}), documentId: 'document-42' },
				{ id: 'spectra-test' },
				(value) => { response = value; },
			)).toBe(false);
			expect(response).toEqual(rpcSuccess({ buffer: [0, 64, 255] }));
			expect(getVisualizerData).toHaveBeenCalledTimes(1);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test.each([false, true])('owns exact-document visualizer observation without Capture authority (legacy grant: %s)', async (legacyGrant) => {
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
			const state = {
				config: CONFIG,
				appliedConfig: CONFIG,
				activeMode: 'bypass',
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 3,
				userHasInteracted: false,
				isPopupOpen: false,
				visualizerSubscribers: new Set<string>(),
			} as MessageHandlerDeps['state'];
			const applyState = mock(async (options?: { captureAdmission?: unknown }) => {
				if (state.visualizerSubscribers.size > 0) {
					expect(options?.captureAdmission).toBeUndefined();
					state.activeMode = 'webaudio';
					state.desiredMode = 'webaudio';
					state.actualMode = 'webaudio';
					state.phase = 'active';
					state.generation += 1;
				} else {
					state.activeMode = 'bypass';
					state.desiredMode = 'bypass';
					state.actualMode = 'bypass';
					state.phase = 'idle';
				}
			});
			const handler = createMessageHandler({
				state,
				runtimeContext: new DocumentRuntimeContext({ documentId: 'document-42', frameId: 0 }),
				policyExecutor: { applyState } as unknown as MessageHandlerDeps['policyExecutor'],
				captureManager: { handleMessage: () => false } as unknown as MessageHandlerDeps['captureManager'],
				audioController: {} as MessageHandlerDeps['audioController'],
				settingsManager: {} as MessageHandlerDeps['settingsManager'],
			});
			let response: unknown;
			const request = {
				protocolVersion: 2,
				requestId: 'visualizer-demand',
				tabId: 42,
				documentId: 'document-42',
				generation: 3,
				type: 'spectra.audio.visualizer.demand.set',
				payload: {
					subscriberId: 'popup-visualizer-a',
					enabled: true,
					...(legacyGrant ? { admission: createCaptureAdmission() } : {}),
				},
			} as const;
			expect(handler(request, { id: 'spectra-test' }, (value) => { response = value; })).toBe(true);
			await Promise.resolve();
			expect(state.visualizerSubscribers).toEqual(new Set(['popup-visualizer-a']));
			expect(isSpectraResponse('spectra.audio.visualizer.demand.set', response)).toBe(true);

			response = undefined;
			expect(handler({
				...request,
				requestId: 'visualizer-release',
				generation: 4,
				payload: { subscriberId: 'popup-visualizer-a', enabled: false },
			}, { id: 'spectra-test' }, (value) => { response = value; })).toBe(true);
			await Promise.resolve();
			expect(state.visualizerSubscribers.size).toBe(0);
			expect(state.actualMode).toBe('bypass');
			expect(isSpectraResponse('spectra.audio.visualizer.demand.set', response)).toBe(true);

			response = undefined;
			expect(handler({ ...request, documentId: 'document-old' }, { id: 'spectra-test' }, (value) => {
				response = value;
			})).toBe(false);
			expect(response).toMatchObject({
				ok: false,
				error: { code: legacyGrant ? 'invalid_request' : 'stale_document' },
			});
			expect(state.visualizerSubscribers.size).toBe(0);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
			if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
			else Reflect.deleteProperty(globalThis, 'document');
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
			userHasInteracted: false,
			isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const handleMessage = mock(() => true);
		const handler = createMessageHandler({
			state,
			runtimeContext: new DocumentRuntimeContext({ documentId: 'document-42', frameId: 0 }),
			captureManager: {
				handleMessage,
				isPending: () => false,
				hasLocalRequest: () => false,
			} as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
		});
		const event = (generation: number, phase: 'starting' | 'active' | 'stopping' | 'idle' | 'error') => ({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			documentId: 'document-42',
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

	test('drops a valid capture event from a different document before touching local state', () => {
		const state = {
			config: CONFIG,
			appliedConfig: CONFIG,
			activeMode: 'bypass',
			desiredMode: 'bypass',
			actualMode: 'bypass',
			phase: 'idle',
			generation: 4,
			userHasInteracted: false,
			isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const handleMessage = mock(() => true);
		const handler = createMessageHandler({
			state,
			runtimeContext: new DocumentRuntimeContext({ documentId: 'document-current', frameId: 0 }),
			captureManager: {
				handleMessage,
				hasLocalRequest: () => false,
			} as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
		});

		handler({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			documentId: 'document-old',
			generation: 5,
			payload: {
				tabId: 42,
				generation: 5,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				lastError: null,
			},
		}, {}, () => undefined);

		expect(handleMessage).not.toHaveBeenCalled();
		expect(state.generation).toBe(4);
		expect(state.actualMode).toBe('bypass');
		expect(state.phase).toBe('idle');

		handler({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			documentId: 'document-current',
			generation: 6,
			payload: {
				tabId: 42,
				generation: 6,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				lastError: null,
			},
		}, { tab: { id: 99 } } as chrome.runtime.MessageSender, () => undefined);
		expect(handleMessage).not.toHaveBeenCalled();
		expect(state.generation).toBe(4);
	});

	test('does not auto-restart Capture after an external stop consumes its authority', async () => {
		const state = {
			config: CONFIG,
			appliedConfig: CONFIG,
			activeMode: 'capture',
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'active',
			generation: 4,
			userHasInteracted: true,
			isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const applyState = mock(async () => undefined);
		const handler = createMessageHandler({
			state,
			runtimeContext: new DocumentRuntimeContext({ documentId: 'document-42', frameId: 0 }),
			policyExecutor: { applyState } as unknown as MessageHandlerDeps['policyExecutor'],
			captureManager: {
				handleMessage: () => true,
				isPending: () => false,
				hasLocalRequest: () => false,
			} as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
		});

		handler({
			protocolVersion: 2,
			type: 'spectra.audio.capture.changed',
			tabId: 42,
			documentId: 'document-42',
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
		expect(applyState).not.toHaveBeenCalled();
		expect(state.phase).toBe('error');
		expect(state.lastError).toContain('Capture stopped');
	});

	test('retires stopped document-output actuals and publishes their loss without replaying the desired policy', () => {
		const desired = { ...CONFIG, documentOutput: true as const, volume: 30, volumeBase: 30, muted: true };
		const state = {
			config: { ...desired }, appliedConfig: { ...desired }, activeMode: 'capture', desiredMode: 'capture',
			actualMode: 'capture', phase: 'active', generation: 4, userHasInteracted: true, isPopupOpen: false,
		} as MessageHandlerDeps['state'];
		const applyState = mock(async () => undefined);
		const published: Array<{ phase: string; actualMode: string; config: typeof state.appliedConfig }> = [];
		const updateBadge = mock(() => published.push({ phase: state.phase, actualMode: state.actualMode,
			config: { ...state.appliedConfig } }));
		const handler = createMessageHandler({
			state,
			runtimeContext: new DocumentRuntimeContext({ documentId: 'document-42', frameId: 0 }),
			policyExecutor: { applyState, updateBadge } as unknown as MessageHandlerDeps['policyExecutor'],
			captureManager: { handleMessage: () => true, hasLocalRequest: () => false } as unknown as MessageHandlerDeps['captureManager'],
			settingsManager: {} as MessageHandlerDeps['settingsManager'],
		});
		const stopped = { protocolVersion: 2, type: 'spectra.audio.capture.changed', tabId: 42,
			documentId: 'document-42', generation: 5, payload: { tabId: 42, generation: 5,
				phase: 'idle', active: false, actualMode: 'bypass', lastError: null } };
		// A different document cannot revoke the current output proof.
		handler({ ...stopped, documentId: 'document-old' }, {}, () => undefined);
		expect(state.appliedConfig.documentOutput).toBe(true);
		expect(updateBadge).not.toHaveBeenCalled();
		handler(stopped, {}, () => undefined);
		expect(state.config).toEqual(desired);
		expect(state.appliedConfig).toMatchObject({ volume: 100, volumeBase: 100, boost: 1, muted: false });
		expect(state.appliedConfig.documentOutput).toBeUndefined();
		expect(applyState).not.toHaveBeenCalled();
		expect(published).toEqual([{ phase: 'error', actualMode: 'bypass', config: state.appliedConfig }]);
		expect(state.lastError).toContain('Capture stopped');
	});

	test('applies presentation settings without re-running audio policy', () => {
		const applyState = mock(async () => undefined);
		const handleMessage = mock(() => true);
		const handler = createMessageHandler({
			state: { config: CONFIG } as MessageHandlerDeps['state'],
			policyExecutor: { applyState } as unknown as MessageHandlerDeps['policyExecutor'],
			captureManager: { handleMessage: () => false } as unknown as MessageHandlerDeps['captureManager'],
			settingsManager: { handleMessage } as unknown as MessageHandlerDeps['settingsManager'],
		});

		handler({
			protocolVersion: 2,
			type: 'spectra.content.settings.changed',
			payload: {
				osdEnabled: true,
				visualizerEnabled: false,
				lang: 'en-US',
				themeMode: 'system',
				pauseRetentionSeconds: 60,
				osdMessages: {
					muted: 'MUTE',
					corsAutoAdded: 'Added {domain}',
					corsAddedSafe: 'Safe {domain}',
					corsCorrectedSafe: 'Corrected {domain}',
				},
			},
		}, {}, () => undefined);

		expect(handleMessage).toHaveBeenCalledTimes(1);
		expect(applyState).not.toHaveBeenCalled();
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
					userHasInteracted: false,
					isPopupOpen: false,
				},
				policyExecutor: { updateConfig },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
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

	test('rejects an internal request whose sender carries no extension id', () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});

		try {
			const handler = createMessageHandler({
				state: {
					config: CONFIG,
					activeMode: null,
					desiredMode: null,
					actualMode: 'bypass',
					phase: 'idle',
					generation: 0,
					userHasInteracted: false,
					isPopupOpen: false,
				},
				captureManager: { handleMessage: () => false },
			} as unknown as MessageHandlerDeps);

			// Both guards used `sender.id && sender.id !== runtimeId`. An absent id
			// short-circuited the condition, so "I cannot prove who sent this" was read
			// as "internal caller" (INV-11: a missing sender check must reject).
			for (const [type, payload] of [
				['spectra.media.play.toggle', {}],
				['spectra.audio.runtime.get', {}],
			] as const) {
				let response: unknown;
				handler(envelope(type, payload), {}, (value) => { response = value; });
				expect((response as { error?: { code?: string } }).error?.code, type).toBe('forbidden');
			}
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
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
					userHasInteracted: false,
					isPopupOpen: false,
				},
				policyExecutor: { updateConfig },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
			} as unknown as MessageHandlerDeps;
			const handler = createMessageHandler(deps);
			let response: unknown;

			const keepChannelOpen = handler(
				envelope('spectra.audio.runtime.configure', {
					config: { ...CONFIG, volume: 125, volumeBase: 100, boost: 1.25 },
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

	test('queues a current-site route refresh without trusting the projected route value', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { hostname: 'media.example.com' },
		});
		try {
			const state = { mediaRoute: 'auto' } as MessageHandlerDeps['state'];
			const applyMediaRouteChange = mock(async () => undefined);
			const handler = createMessageHandler({
				state,
				policyExecutor: { applyMediaRouteChange },
				captureManager: { handleMessage: mock(() => false) },
				settingsManager: {},
			} as unknown as MessageHandlerDeps);
			const event = (mediaRoute: 'auto' | 'direct' | 'capture') => ({
				protocolVersion: 2,
				type: 'spectra.audio.route.changed',
				payload: { domain: 'media.example.com', mediaRoute },
			});

			expect(handler(event('direct'), { id: 'spectra-test' }, () => undefined)).toBe(false);
			await Promise.resolve();
			expect(state.mediaRoute).toBe('auto');
			expect(applyMediaRouteChange).toHaveBeenCalledTimes(1);

			expect(handler(event('capture'), { id: 'spectra-test' }, () => undefined)).toBe(false);
			await Promise.resolve();
			expect(state.mediaRoute).toBe('auto');
			expect(applyMediaRouteChange).toHaveBeenCalledTimes(2);

			expect(handler({
				...event('direct'),
				payload: { domain: 'other.example.com', mediaRoute: 'direct' },
			}, { id: 'spectra-test' }, () => undefined)).toBe(false);
			expect(applyMediaRouteChange).toHaveBeenCalledTimes(2);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
			if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
			else Reflect.deleteProperty(globalThis, 'location');
		}
	});
});
