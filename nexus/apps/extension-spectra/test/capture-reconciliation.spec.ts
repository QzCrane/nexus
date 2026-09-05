import { describe, expect, test } from 'bun:test';
import {
	audioConfigToProcessorConfig,
	DEFAULT_AUDIO_CONFIG,
	SPECTRA_PROTOCOL_VERSION,
	resolveAudioVolume,
} from '@nexus/contracts';
import {
	cleanupCaptureState,
	reconcileCaptureStates,
	registerCaptureHandlers,
	teardownCaptureState,
} from '../src/background/handlers/capture';
import {
	forgetAudioSession,
	getAudioSession,
	removeAudioSession,
	updateAudioSession,
} from '../src/background/audio-session-store';
import { getOffscreenLeaseCount } from '../src/background/offscreen-coordinator';
import { mintCaptureAdmission } from '../src/background/capture-admission';

function captureStartAdmission(tabId: number, documentId = `document-${tabId}`) {
	return mintCaptureAdmission({
		kind: 'capture-start',
		operationId: crypto.randomUUID(),
		document: { tabId, frameId: 0, documentId },
		documentEpoch: 1,
		issuer: 'control-authority',
	});
}

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
							return idleAck(message.tabId, message.generation);
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
						return idleAck(51, message.generation);
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

	test('does not detach a rejecting transition-cleanup promise', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const unhandled: unknown[] = [];
		const rejectionListener = (reason: unknown) => unhandled.push(reason);

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 52 }],
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						throw new Error('persistent HELLO failure');
					}
					return undefined;
				},
			}),
		});

		process.on('unhandledRejection', rejectionListener);
		try {
			registerCaptureHandlers();
			await expect(teardownCaptureState(52)).rejects.toThrow('persistent HELLO failure');
			await Bun.sleep(0);
			expect(unhandled).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', rejectionListener);
			cleanupCaptureState(52);
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
								controlRevision: 0,
								error: { code: 'busy', message: 'still stopping', retryable: true },
							};
						}
						return idleAck(61, message.generation);
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return idleAck(message.tabId, message.generation);
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

	test('adopts an idle host tombstone and retries START in the same transaction', async () => {
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
								generation: 300,
								controlRevision: Number(message.controlRevision ?? 0),
								error: {
									code: 'stale_capture_intent',
									message: 'Capture configuration belongs to a stopped generation',
									retryable: true,
								},
							};
						}
						return activeAck(72, message.generation, message.controlRevision);
					}
					if (message.type === 'OFFSCREEN_AUDIO_CANCEL_START'
						|| message.type === 'OFFSCREEN_AUDIO_STOP') {
						return idleAck(72, message.generation);
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
				payload: {
					enabled: true,
					config: DEFAULT_AUDIO_CONFIG,
					admission: captureStartAdmission(72),
				},
				tabId: 72,
				generation: 7,
			} as const;
			const started = await invokeRuntimeRequest(listeners, {
				...baseRequest,
				requestId: 'capture-first-attempt',
			}, contentSender(72)) as { ok: boolean; data: { phase: string; generation: number } };
			expect(started.ok).toBe(true);
			expect(started.data).toEqual(expect.objectContaining({ phase: 'active', generation: 301 }));
			expect(starts.map(({ generation }) => generation)).toEqual([7, 301]);
			expect(starts.map(({ config }) => config)).toEqual([
				audioConfigToProcessorConfig(DEFAULT_AUDIO_CONFIG),
				audioConfigToProcessorConfig(DEFAULT_AUDIO_CONFIG),
			]);
			expect(await teardownCaptureState(72)).toBe(true);
		} finally {
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('revokes a consumed admission across an in-flight stream-id await before physical start', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const listeners: RuntimeMessageListener[] = [];
		const offscreenMessages: Array<Record<string, unknown>> = [];
		let resolveStreamId: ((streamId?: string) => void) | undefined;

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 76 }],
				listeners,
				getStreamId: (callback) => { resolveStreamId = callback; },
				sendOffscreen: async (message) => {
					offscreenMessages.push(structuredClone(message));
					if (message.type === 'OFFSCREEN_HOST_HELLO') {
						return { audioTabs: [], remoteTabs: [] };
					}
					if (message.type === 'OFFSCREEN_AUDIO_CANCEL_START'
						|| message.type === 'OFFSCREEN_AUDIO_STOP') {
						return idleAck(76, message.generation);
					}
					return undefined;
				},
			}),
		});

		try {
			registerCaptureHandlers();
			const start = invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-navigation-fence',
				type: 'spectra.audio.capture.set',
				tabId: 76,
				generation: 1,
				payload: {
					enabled: true,
					config: DEFAULT_AUDIO_CONFIG,
					admission: captureStartAdmission(76),
				},
			}, contentSender(76));
			await waitFor(() => resolveStreamId !== undefined);

			// teardownCaptureState advances the synchronous lifecycle fence before
			// it waits on the same per-tab queue. The delayed callback therefore
			// cannot turn the already-consumed grant into a physical START.
			const teardown = teardownCaptureState(76);
			resolveStreamId?.('stream-76');
			expect(await start).toMatchObject({
				ok: false,
				error: { code: 'capture_unavailable' },
			});
			expect(await teardown).toBe(true);
			expect(offscreenMessages.some(({ type }) => type === 'OFFSCREEN_AUDIO_START')).toBe(false);
		} finally {
			cleanupCaptureState(76);
			await forgetAudioSession(76);
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('publishes authoritative snapshots before stable START and STOP capture events', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const listeners: RuntimeMessageListener[] = [];
		const runtimeMessages: Array<Record<string, unknown>> = [];
		const tabMessages: Array<{
			tabId: number;
			message: Record<string, unknown>;
			options?: { documentId?: string };
		}> = [];
		const config = {
			...DEFAULT_AUDIO_CONFIG,
			volume: 137,
			volumeBase: 100,
			boost: 1.37,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		};
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
				tabMessages,
				getStreamId: (callback) => callback('stream-73'),
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') return { audioTabs: [], remoteTabs: [] };
					if (message.type === 'OFFSCREEN_AUDIO_START') {
						return activeAck(73, message.generation, message.controlRevision, config);
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return idleAck(73, message.generation, 1);
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
				payload: { enabled: true, config, admission: captureStartAdmission(73) },
			}, contentSender(73)) as { ok: boolean };
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
			const exactDocumentEvents = tabMessages.filter(({ message }) => (
				message.type === 'spectra.audio.capture.changed'
			));
			expect(exactDocumentEvents.length).toBeGreaterThan(0);
			expect(exactDocumentEvents.every(({ tabId, options }) => (
				tabId === 73 && options?.documentId === identity.documentId
			))).toBe(true);
			expect(exactDocumentEvents.find(({ message }) => {
			if (message.type !== 'spectra.audio.capture.changed') return false;
			const payload = message.payload as { phase?: unknown } | undefined;
			return payload?.phase === 'active';
		})?.message).toMatchObject({
				documentId: identity.documentId,
				generation: 20,
				payload: { tabId: 73, generation: 20, phase: 'active' },
			});

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
				payload: { enabled: true, config, admission: captureStartAdmission(73) },
			}, contentSender(73));
			runtimeMessages.length = 0;
			const stopped = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-snapshot-stop',
				type: 'spectra.audio.capture.set',
				tabId: 73,
				generation: 22,
				payload: { enabled: false, config },
			}, contentSender(73)) as { ok: boolean };
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
				config: { ...DEFAULT_AUDIO_CONFIG, volume: 141, boost: 1.41 },
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

	test('drops OFFSCREEN_AUDIO_ENDED for an invalidated document without throwing and still releases the lease', async () => {
		// rule: when a tab navigates, lifecycle.clearTabDocumentState calls
		// removeAudioSession(tabId), which invalidates the prior documentId but
		// does not clear the invalidation set (only forgetAudioSession does).
		// If OFFSCREEN_AUDIO_ENDED arrives from the offscreen host afterwards,
		// the capture state still references the old document identity. Without
		// the invalidation guard in commitCaptureSnapshot, updateAudioSession
		// would throw StaleAudioSessionError and escape as an unhandled rejection
		// through the `void serializeTransition` fire-and-forget caller.
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timerHarness = installFastTimerHarness();
		const listeners: RuntimeMessageListener[] = [];
		const runtimeMessages: Array<Record<string, unknown>> = [];
		const identity = {
			tabId: 75,
			documentId: 'document-75a',
			origin: 'https://media.example',
		};
		const config = {
			...DEFAULT_AUDIO_CONFIG,
			volume: 137,
			volumeBase: 100,
			boost: 1.37,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		};

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [{ id: 75 }],
				listeners,
				runtimeMessages,
				getStreamId: (callback) => callback('stream-75'),
				sendOffscreen: async (message) => {
					if (message.type === 'OFFSCREEN_HOST_HELLO') return { audioTabs: [], remoteTabs: [] };
					if (message.type === 'OFFSCREEN_AUDIO_START') {
						return activeAck(75, message.generation, message.controlRevision, config);
					}
					if (message.type === 'OFFSCREEN_AUDIO_STOP') {
						return idleAck(75, message.generation, 1);
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
				generation: 30,
				error: null,
			});
			registerCaptureHandlers();

			const started = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-stale-start',
				type: 'spectra.audio.capture.set',
				tabId: 75,
				generation: 31,
				payload: {
					enabled: true,
					config,
					admission: captureStartAdmission(75, 'document-75a'),
				},
			}, contentSender(75, 'document-75a')) as { ok: boolean };
			expect(started.ok).toBe(true);
			expect(getOffscreenLeaseCount()).toBe(1);

			// Simulate top-level navigation: lifecycle.clearTabDocumentState calls
			// removeAudioSession, which invalidates document-75a and deletes the
			// cached snapshot. A new document has NOT yet written a session.
			await removeAudioSession(75);
			expect(await getAudioSession(75)).toBeNull();

			// OFFSCREEN_AUDIO_ENDED arrives with the stale capture state's identity.
			// This must not throw StaleAudioSessionError, must release the lease,
			// and must not emit any session.changed event for the invalidated doc.
			runtimeMessages.length = 0;
			const unhandled: unknown[] = [];
			const rejectionListener = (reason: unknown) => unhandled.push(reason);
			process.on('unhandledRejection', rejectionListener);
			try {
				emitRuntimeEvent(listeners, {
					type: 'OFFSCREEN_AUDIO_ENDED',
					tabId: 75,
					generation: 31,
				});
				await waitForAsync(async () => getOffscreenLeaseCount() === 0);
			} finally {
				process.off('unhandledRejection', rejectionListener);
			}

			expect(getOffscreenLeaseCount()).toBe(0);
			expect(unhandled).toHaveLength(0);
		expect(await getAudioSession(75)).toBeNull();
			expect(runtimeMessages.some((m) => m.type === 'spectra.audio.session.changed')).toBe(false);
		} finally {
			cleanupCaptureState(75);
			await forgetAudioSession(75);
			timerHarness.restore();
			restore('chrome', chromeDescriptor);
		}
	});

	test('rejects a no-tab capture RPC even when the payload names a target tab', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const listeners: RuntimeMessageListener[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: createChromeHarness({
				queryTabs: [],
				listeners,
				sendOffscreen: async () => ({ audioTabs: [], remoteTabs: [] }),
			}),
		});
		try {
			registerCaptureHandlers();
			const response = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'capture-no-tab-forged-target',
				type: 'spectra.audio.capture.set',
				tabId: 999,
				generation: 1,
				payload: { enabled: false, config: DEFAULT_AUDIO_CONFIG },
			});
			expect(response).toMatchObject({
				ok: false,
				error: { code: 'forbidden' },
			});
		} finally {
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
	tabMessages?: Array<{
		tabId: number;
		message: Record<string, unknown>;
		options?: { documentId?: string };
	}>;
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
			sendMessage: async (
				tabId: number,
				message: Record<string, unknown>,
				messageOptions?: { documentId?: string },
			) => {
				options.tabMessages?.push({
					tabId,
					message: structuredClone(message),
					...(messageOptions ? { options: structuredClone(messageOptions) } : {}),
				});
			},
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

function idleAck(tabId: unknown, generation: unknown, controlRevision = 0) {
	return {
		ok: true,
		tabId: Number(tabId),
		generation: Number(generation),
		controlRevision,
		phase: 'idle',
		contextState: 'closed',
		graphSignature: 'none',
		normalizedActualConfig: null,
	};
}

function activeAck(
	tabId: unknown,
	generation: unknown,
	controlRevision: unknown,
	config = DEFAULT_AUDIO_CONFIG,
) {
	return {
		ok: true,
		tabId: Number(tabId),
		generation: Number(generation),
		controlRevision: Number(controlRevision ?? 0),
		phase: 'active',
		contextState: 'running',
		graphSignature: 'bass:0|eq:-|compressor:0|mono:0|pan:0|delay:0',
		normalizedActualConfig: {
			boostGain: resolveAudioVolume(config).boost,
			compressor: config.compressor,
			mono: config.mono,
			bass: config.bass,
			eqValues: [...config.eqValues],
			pan: config.pan,
			delay: config.delay,
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
	sender: chrome.runtime.MessageSender = { id: 'spectra-test' },
): Promise<unknown> {
	for (const listener of listeners) {
		let resolveResponse!: (response: unknown) => void;
		let didRespond = false;
		const response = new Promise<unknown>((resolve) => {
			resolveResponse = (value) => {
				didRespond = true;
				resolve(value);
			};
		});
		const handled = listener(message, sender, resolveResponse);
		if (handled === true || didRespond) return response;
	}
	throw new Error('No runtime listener handled the request');
}

function contentSender(
	tabId: number,
	documentId = `document-${tabId}`,
): chrome.runtime.MessageSender {
	return {
		id: 'spectra-test',
		tab: { id: tabId, url: 'https://media.example/page' },
		url: 'https://media.example/page',
		documentId,
	} as chrome.runtime.MessageSender;
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
