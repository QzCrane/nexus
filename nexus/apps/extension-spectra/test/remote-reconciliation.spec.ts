import { describe, expect, test } from 'bun:test';
import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { initRemoteService } from '../src/background/remote-service';
import {
	acquireOffscreenLease,
	flushOffscreenCoordinatorLifecycle,
	getOffscreenLeaseCount,
	isOffscreenHostStateUnknown,
	reconcileOffscreenHost,
	releaseOffscreenLease,
} from '../src/background/offscreen-coordinator';

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void,
) => boolean | undefined;

describe('remote service-worker reconciliation', () => {
	test('quarantines an unowned failed host and recovers its session on the next GET', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const timers = installFastTimerHarness();
		const listeners: RuntimeListener[] = [];
		const removedListeners: Array<(tabId: number) => void> = [];
		const tabMessages: Array<Record<string, unknown>> = [];
		const closeTabMessages: Array<Record<string, unknown>> = [];
		const sessionId = 'A'.repeat(22);
		const hostSession = {
			protocolVersion: 2 as const,
			sessionId,
			peerId: `spectra-${'b'.repeat(32)}`,
			secret: 'C'.repeat(22),
			createdAt: 100,
			pairingExpiresAt: 10_000,
			tabId: 71,
			connected: true,
			capability: 'D'.repeat(22),
			reconnectUntil: null,
			generation: 7,
		};
		let hasDocument = true;
		let helloCalls = 0;
		let createDocumentCalls = 0;

		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				offscreen: {
					hasDocument: async () => hasDocument,
					createDocument: async () => { createDocumentCalls += 1; },
					closeDocument: async () => undefined,
				},
					runtime: {
					id: 'spectra-test',
					getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
					onMessage: { addListener: (listener: RuntimeListener) => listeners.push(listener) },
						sendMessage: async (message: Record<string, unknown>) => {
						if (message.type === 'OFFSCREEN_HOST_HELLO') {
							helloCalls += 1;
							if (helloCalls <= 3) throw new Error('temporary HELLO failure');
							return { audioTabs: [], remoteTabs: [{ tabId: 71, sessionId }] };
						}
						if (message.type === 'REMOTE_HOST_GET_STATUS') return { session: hostSession };
						if (message.type === 'REMOTE_HOST_CLOSE_TAB') {
							closeTabMessages.push(structuredClone(message));
							return { success: false };
						}
						if (message.type === 'REMOTE_HOST_SEND_STATE') return { success: true };
						return undefined;
					},
				},
					tabs: {
					get: async () => ({ id: 71, url: 'https://media.example', title: 'Media' }),
					onRemoved: { addListener: (listener: (tabId: number) => void) => removedListeners.push(listener) },
					sendMessage: async (_tabId: number, message: Record<string, unknown>) => {
						tabMessages.push(structuredClone(message));
						if (message.type === 'spectra.content.runtime.status') {
							return {
								ok: true,
								data: {
									bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
									runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
									ready: true,
									ownedSources: [],
								},
							};
						}
						if (message.type === 'spectra.media.play.toggle') {
							return { ok: true, data: { playing: true } };
						}
						if (message.type === 'spectra.media.state.get') {
							return {
								ok: true,
								data: { playing: true, speed: 1, pipActive: false, preservePitch: true },
							};
						}
						return { ok: false, error: { code: 'unsupported', message: 'Unsupported', retryable: false } };
					},
				},
				webNavigation: {
					getFrame: async () => ({
						documentId: 'document-71',
						frameId: 0,
						parentFrameId: -1,
						url: 'https://media.example',
					}),
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
			initRemoteService();
			await waitFor(() => (
				helloCalls === 3
				&& !isOffscreenHostStateUnknown()
				&& timers.pendingLongCount() === 1
			));
			expect(isOffscreenHostStateUnknown()).toBe(false);
			expect(timers.pendingLongCount()).toBe(1);
			expect(removedListeners.length).toBeGreaterThan(0);
			for (const listener of removedListeners) listener(72);
			await waitFor(() => closeTabMessages.length === 1);
			expect(closeTabMessages[0]).toMatchObject({ type: 'REMOTE_HOST_CLOSE_TAB', tabId: 72 });
			expect(createDocumentCalls).toBe(0);

			await acquireOffscreenLease('audio:71');
			releaseOffscreenLease('audio:71');
			expect(timers.pendingLongCount()).toBe(1);

			const response = await invokeRuntimeRequest(listeners, {
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'remote-reconcile-get',
				type: 'spectra.remote.session.get',
				tabId: 71,
				payload: { tabId: 71 },
			});
			expect(helloCalls).toBe(4);
			expect(isOffscreenHostStateUnknown()).toBe(false);
			expect(getOffscreenLeaseCount()).toBe(1);
			expect(timers.pendingLongCount()).toBe(0);
			expect(response).toEqual({
				ok: true,
				data: {
					session: {
						protocolVersion: 2,
						sessionId,
						peerId: hostSession.peerId,
						secret: hostSession.secret,
						createdAt: 100,
						pairingExpiresAt: 10_000,
						tabId: 71,
						connected: true,
					},
					connected: true,
				},
			});

			const command = invokeRuntimeEvent(listeners, {
				type: 'REMOTE_HOST_EXECUTE_COMMAND',
				tabId: 71,
				sessionId,
				capability: hostSession.capability,
				sequence: 1,
				generation: hostSession.generation,
				command: 'play_pause',
			});
			expect(command.handled).toBe(true);
			expect(await command.response).toEqual({ settled: true });

			hasDocument = false;
			await reconcileOffscreenHost();
			await timers.fireLongTimers();
			await flushOffscreenCoordinatorLifecycle();
		} finally {
			timers.restore();
			restore('chrome', chromeDescriptor);
		}
	});
});

async function invokeRuntimeRequest(
	listeners: RuntimeListener[],
	message: unknown,
): Promise<unknown> {
	for (const listener of listeners) {
		let resolveResponse!: (response: unknown) => void;
		const response = new Promise<unknown>((resolve) => { resolveResponse = resolve; });
		const handled = listener(message, {
			id: 'spectra-test',
			url: 'chrome-extension://spectra-test/popup.html',
		}, resolveResponse);
		if (handled === true) return response;
	}
	throw new Error('No runtime listener handled the remote request');
}

function invokeRuntimeEvent(
	listeners: RuntimeListener[],
	message: unknown,
): { handled: boolean; response: Promise<unknown> } {
	for (const listener of listeners) {
		let resolveResponse!: (response: unknown) => void;
		const response = new Promise<unknown>((resolve) => { resolveResponse = resolve; });
		const handled = listener(message, {
			id: 'spectra-test',
			url: 'chrome-extension://spectra-test/offscreen.html',
		}, resolveResponse);
		if (handled === true) return { handled, response };
	}
	return { handled: false, response: Promise.resolve(undefined) };
}

function installFastTimerHarness(): {
	pendingLongCount(): number;
	fireLongTimers(): Promise<void>;
	restore(): void;
} {
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
		pendingLongCount: () => pending.size,
		async fireLongTimers() {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback();
			await Promise.resolve();
		},
		restore() {
			pending.clear();
			restore('setTimeout', setTimeoutDescriptor);
			restore('clearTimeout', clearTimeoutDescriptor);
		},
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) {
			await Promise.resolve();
			await Promise.resolve();
			return;
		}
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function restore(
	key: 'chrome' | 'setTimeout' | 'clearTimeout',
	descriptor?: PropertyDescriptor,
): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
