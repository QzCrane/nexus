import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, SPECTRA_PROTOCOL_VERSION } from '@nexus/contracts';
import {
	cleanupCaptureState,
	reconcileCaptureStates,
	registerCaptureHandlers,
	teardownCaptureState,
} from '../src/background/handlers/capture';
import {
	forgetAudioSession,
	getAudioSession,
	updateAudioSession,
} from '../src/background/audio-session-store';
import { getOffscreenLeaseCount } from '../src/background/offscreen-coordinator';

describe('capture restart reconciliation barrier', () => {
	test('waits for the host generation before an immediate tab teardown', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
		const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');
		const hello = deferred<{ audioTabs: Array<{ tabId: number; generation: number }>; remoteTabs: [] }>();
		const offscreenMessages: Array<Record<string, unknown>> = [];
		const timers = new Map<number, () => void>();
		let nextTimer = 0;

		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			value: (callback: () => void) => {
				const id = ++nextTimer;
				timers.set(id, callback);
				return id;
			},
		});
		Object.defineProperty(globalThis, 'clearTimeout', {
			configurable: true,
			value: (id: number) => timers.delete(id),
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				offscreen: {
					hasDocument: async () => true,
					createDocument: async () => undefined,
					closeDocument: async () => undefined,
				},
				runtime: {
					id: 'spectra-test',
					getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
					onMessage: { addListener: () => undefined },
					sendMessage: async (message: Record<string, unknown>) => {
						if (message.target !== 'offscreen') return undefined;
						offscreenMessages.push(structuredClone(message));
						if (message.type === 'OFFSCREEN_HOST_HELLO') return hello.promise;
						if (message.type === 'OFFSCREEN_AUDIO_STOP') {
							return {
								ok: true,
								tabId: message.tabId,
								generation: message.generation,
								phase: 'idle',
							};
						}
						return undefined;
					},
				},
				tabs: {
					query: async () => [{ id: 41 }],
					sendMessage: async () => undefined,
				},
				storage: {
					session: {
						get: async () => ({}),
						set: async () => undefined,
						remove: async () => undefined,
					},
				},
			},
		});

		try {
			registerCaptureHandlers();
			const teardown = teardownCaptureState(41);
			await waitFor(() => offscreenMessages.length === 1);
			expect(offscreenMessages.map(({ type }) => type)).toEqual(['OFFSCREEN_HOST_HELLO']);

			hello.resolve({ audioTabs: [{ tabId: 41, generation: 12 }], remoteTabs: [] });
			expect(await teardown).toBe(true);
			expect(offscreenMessages).toContainEqual(expect.objectContaining({
				type: 'OFFSCREEN_AUDIO_STOP',
				tabId: 41,
				generation: 13,
			}));
		} finally {
			timers.clear();
			restore('chrome', chromeDescriptor);
			restore('setTimeout', setTimeoutDescriptor);
			restore('clearTimeout', clearTimeoutDescriptor);
		}
	});

	test('retries a failed readiness handshake before allowing teardown', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const offscreenMessages: Array<Record<string, unknown>> = [];
		let helloCalls = 0;

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 51 }],
				sendOffscreen: async (message) => {
					offscreenMessages.push(structuredClone(message));
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						helloCalls += 1;
						if (helloCalls <= 3) throw new Error('temporary HELLO failure');
						return { audioTabs: [{ tabId: 51, generation: 9 }], remoteTabs: [] };
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return { ok: true, tabId: 51, generation: message.generation, phase: 'idle' };
					}
					return undefined;
				},
			}),
		});

		try {
			registerCaptureHandlers();
			expect(await teardownCaptureState(51)).toBe(true);
			expect(helloCalls).toBe(4);
			expect(offscreenMessages).toContainEqual(expect.objectContaining({
				type: 'OFFSCREEN_AUDIO_STOP',
				tabId: 51,
				generation: 10,
			}));
		} finally {
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('retains an orphan lease through failed STOPs and releases only after idle ACK', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		let orphanStopCalls = 0;

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [],
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						return { audioTabs: [{ tabId: 61, generation: 3 }], remoteTabs: [] };
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP' && message.tabId === 61) {
						orphanStopCalls += 1;
						expect(getOffscreenLeaseCount()).toBe(1);
						if (orphanStopCalls < 3) {
							return {
								ok: false,
								tabId: 61,
								generation: message.generation,
								error: { code: 'busy', message: 'still stopping', retryable: true },
							};
						}
						return { ok: true, tabId: 61, generation: message.generation, phase: 'idle' };
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return { ok: true, tabId: message.tabId, generation: message.generation, phase: 'idle' };
					}
					return undefined;
				},
			}),
		});

		try {
			registerCaptureHandlers();
			expect(await teardownCaptureState(62)).toBe(true);
			expect(orphanStopCalls).toBe(3);
			expect(getOffscreenLeaseCount()).toBe(0);
		} finally {
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('advances generation when retrying a START rejected behind its cancellation tombstone', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const listeners: RuntimeMessageListener[] = [];
		const starts: Array<Record<string, unknown>> = [];

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 72 }],
				listeners,
				getStreamId: (callback) => callback('stream-72'),
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						return { audioTabs: [], remoteTabs: [] };
					}
					if (message.type === 'OFFSCREEN_AUDIO_START') {
						starts.push(structuredClone(message));
						if (starts.length === 1) {
							return {
								ok: false,
								tabId: 72,
								generation: message.generation,
								error: { code: 'denied', message: 'temporary denial', retryable: true },
							};
						}
						return { ok: true, tabId: 72, generation: message.generation, phase: 'active' };
					}
					if (message.type === 'OFFSCREEN_AUDIO_CANCEL_START'
						|| message.type === 'OFFSCREEN_AUDIO_STOP') {
						return { ok: true, tabId: 72, generation: message.generation, phase: 'idle' };
					}
					return undefined;
				},
			}),
		});

		try {
			registerCaptureHandlers();
			const baseRequest = {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				type: 'spectra.audio.capture.set',
				payload: { enabled: true, config: DEFAULT_AUDIO_CONFIG },
				tabId: 72,
				generation: 7,
			} as const;
			const failed = await invokeRuntimeRequest(listeners, {
				...baseRequest,
				requestId: 'capture-first-attempt',
			}) as { ok: boolean; data: { phase: string; generation: number } };
			expect(failed.ok).toBe(true);
			expect(failed.data).toEqual(expect.objectContaining({ phase: 'error', generation: 7 }));

			const retried = await invokeRuntimeRequest(listeners, {
				...baseRequest,
				requestId: 'capture-retry',
			}) as { ok: boolean; data: { phase: string; generation: number } };
			expect(retried.ok).toBe(true);
			expect(retried.data).toEqual(expect.objectContaining({ phase: 'active', generation: 8 }));
			expect(starts.map(({ generation }) => generation)).toEqual([7, 8]);
			expect(await teardownCaptureState(72)).toBe(true);
		} finally {
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('publishes authoritative snapshots before stable START and STOP capture events', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const listeners: RuntimeMessageListener[] = [];
		const runtimeMessages: Array<Record<string, unknown>> = [];
		const config = { ...DEFAULT_AUDIO_CONFIG, volume: 137, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
		const identity = {
			tabId: 73,
			documentId: 'document-73',
			origin: 'https://media.example',
		};

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 73 }],
				listeners,
				runtimeMessages,
				getStreamId: (callback) => callback('stream-73'),
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') return { audioTabs: [], remoteTabs: [] };
					if (message.type === 'OFFSCREEN_AUDIO_START') {
						return { ok: true, tabId: 73, generation: message.generation, phase: 'active' };
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return { ok: true, tabId: 73, generation: message.generation, phase: 'idle' };
					}
					return undefined;
				},
			}),
		});

		try {
			await updateAudioSession(identity, {
				config: DEFAULT_AUDIO_CONFIG,
				desiredMode: 'capture',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 19,
				error: null,
			});
			runtimeMessages.length = 0;
			registerCaptureHandlers();

			const started = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-snapshot-start',
				type: 'spectra.audio.capture.set',
				tabId: 73,
				generation: 20,
				payload: { enabled: true, config },
			}) as { ok: boolean };
			expect(started.ok).toBe(true);
			expect(await getAudioSession(73)).toMatchObject({
				actualMode: 'capture',
				phase: 'active',
				generation: 20,
				actualConfig: { volume: 137 },
			});
			expect(stableEventOrder(runtimeMessages, 20, 'active')).toEqual([
				'spectra.audio.session.changed',
				'spectra.audio.capture.changed',
			]);

			runtimeMessages.length = 0;
			emitRuntimeEvent(listeners, {
				type: 'OFFSCREEN_AUDIO_ENDED',
				tabId: 73,
				generation: 20,
			});
			await waitForAsync(async () => (await getAudioSession(73))?.phase === 'error');
			expect(await getAudioSession(73)).toMatchObject({
				actualMode: 'bypass',
				phase: 'error',
				generation: 20,
			});
			expect(stableEventOrder(runtimeMessages, 20, 'error')).toEqual([
				'spectra.audio.session.changed',
				'spectra.audio.capture.changed',
			]);

			await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-snapshot-restart',
				type: 'spectra.audio.capture.set',
				tabId: 73,
				generation: 21,
				payload: { enabled: true, config },
			});
			runtimeMessages.length = 0;
			const stopped = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-snapshot-stop',
				type: 'spectra.audio.capture.set',
				tabId: 73,
				generation: 22,
				payload: { enabled: false, config },
			}) as { ok: boolean };
			expect(stopped.ok).toBe(true);
			expect(await getAudioSession(73)).toMatchObject({
				actualMode: 'bypass',
				phase: 'idle',
				generation: 22,
				actualConfig: { volume: 100 },
			});
			expect(stableEventOrder(runtimeMessages, 22, 'idle')).toEqual([
				'spectra.audio.session.changed',
				'spectra.audio.capture.changed',
			]);
		} finally {
			cleanupCaptureState(73);
			await forgetAudioSession(73);
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('mirrors recovered and lost host processors into the authoritative snapshot', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		let hostAudioTabs: Array<{ tabId: number; generation: number }> = [{ tabId: 74, generation: 31 }];
		const identity = { tabId: 74, documentId: 'document-74', origin: 'https://media.example' };

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 74 }],
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						return { audioTabs: hostAudioTabs, remoteTabs: [] };
					}
					return undefined;
				},
			}),
		});

		try {
			await updateAudioSession(identity, {
				config: { ...DEFAULT_AUDIO_CONFIG, volume: 141 },
				desiredMode: 'capture',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 30,
				error: null,
			});
			await reconcileCaptureStates();
			expect(await getAudioSession(74)).toMatchObject({
				actualMode: 'capture',
				phase: 'active',
				generation: 31,
				actualConfig: { volume: 141 },
			});

			hostAudioTabs = [];
			await reconcileCaptureStates();
			expect(await getAudioSession(74)).toMatchObject({
				actualMode: 'bypass',
				phase: 'error',
				generation: 32,
				actualConfig: { volume: 100 },
			});
		} finally {
			cleanupCaptureState(74);
			await forgetAudioSession(74);
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});
});

type RuntimeMessageListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
) => boolean | undefined;

function createChromeHarness(options: {
	queryTabs: Array<{ id: number }>;
	sendOffscreen(message: Record<string, unknown>): Promise<unknown>;
	listeners?: RuntimeMessageListener[];
	runtimeMessages?: Array<Record<string, unknown>>;
	getStreamId?: (callback: (streamId?: string) => void) => void;
}): unknown {
	return {
		offscreen: {
			hasDocument: async () => true,
			createDocument: async () => undefined,
			closeDocument: async () => undefined,
		},
		runtime: {
			id: 'spectra-test',
			getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
			onMessage: {
				addListener: (listener: RuntimeMessageListener) => options.listeners?.push(listener),
			},
			sendMessage: async (message: Record<string, unknown>) => {
				if (message.target === 'offscreen') return options.sendOffscreen(message);
				options.runtimeMessages?.push(structuredClone(message));
				return undefined;
			},
		},
		tabs: {
			query: async () => options.queryTabs,
			sendMessage: async () => undefined,
		},
		tabCapture: {
			getMediaStreamId: (
				_options: Record<string, unknown>,
				callback: (streamId?: string) => void,
			) => options.getStreamId?.(callback),
		},
		storage: {
			session: {
				get: async () => ({}),
				set: async () => undefined,
				remove: async () => undefined,
			},
		},
	};
}

function stableEventOrder(
	messages: Array<Record<string, unknown>>,
	generation: number,
	phase: 'active' | 'idle' | 'error',
): string[] {
	return messages.flatMap((message) => {
		if (message.generation !== generation) return [];
		if (message.type === 'spectra.audio.session.changed') {
			const payload = message.payload as { phase?: unknown } | undefined;
			return payload?.phase === phase ? [message.type] : [];
		}
		if (message.type === 'spectra.audio.capture.changed') {
			const payload = message.payload as { phase?: unknown } | undefined;
			return payload?.phase === phase ? [message.type] : [];
		}
		return [];
	});
}

function emitRuntimeEvent(listeners: RuntimeMessageListener[], message: unknown): void {
	for (const listener of listeners) {
		listener(message, {
			id: 'spectra-test',
			url: 'chrome-extension://spectra-test/offscreen.html',
		}, () => undefined);
	}
}

async function invokeRuntimeRequest(
	listeners: RuntimeMessageListener[],
	message: unknown,
): Promise<unknown> {
	for (const listener of listeners) {
		let resolveResponse!: (response: unknown) => void;
		const response = new Promise<unknown>((resolve) => { resolveResponse = resolve; });
		const handled = listener(message, { id: 'spectra-test' }, resolveResponse);
		if (handled === true) return response;
	}
	throw new Error('No runtime listener handled the request');
}

function installFastTimerHarness(): { restore(): void } {
	const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
	const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');
	const pending = new Map<number, () => void>();
	let nextId = 0;
	Object.defineProperty(globalThis, 'setTimeout', {
		configurable: true,
		value: (callback: () => void, delay = 0) => {
			const id = ++nextId;
			if (delay < 1_000) queueMicrotask(callback);
			else pending.set(id, callback);
			return id;
		},
	});
	Object.defineProperty(globalThis, 'clearTimeout', {
		configurable: true,
		value: (id: number) => pending.delete(id),
	});
	return {
		restore() {
			pending.clear();
			restore('setTimeout', setTimeoutDescriptor);
			restore('clearTimeout', clearTimeoutDescriptor);
		},
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

async function waitForAsync(predicate: () => Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (await predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

function restore(
	key: 'chrome' | 'setTimeout' | 'clearTimeout',
	descriptor?: PropertyDescriptor,
): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
