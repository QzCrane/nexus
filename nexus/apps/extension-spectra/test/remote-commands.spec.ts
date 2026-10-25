import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	REMOTE_COMMANDS,
	REMOTE_COMMAND_DESCRIPTORS,
	type ControlApplyAck,
	type ControlOperationAck,
	type ControlSnapshot,
} from '@nexus/contracts';
import {
	executeCommand,
	invalidateRemoteTab,
	setStateCallback,
	syncState,
	type RemoteControlGateway,
} from '../src/background/remote-commands';

const TAB_ID = 9_301;

function deferred<T>() {
	let resolve!: (value?: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = (value?: T) => done(value as T);
	});
	return { promise, resolve };
}

afterEach(async () => {
	setStateCallback(null);
});

describe('remote acknowledged audio state', () => {
	test('does not settle synchronization before the transport commits its delivered generation', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let releaseDelivery: (() => void) | undefined;
		const delivery = new Promise<void>((resolve) => { releaseDelivery = resolve; });
		let markDeliveryStarted: (() => void) | undefined;
		const deliveryStarted = new Promise<void>((resolve) => { markDeliveryStarted = resolve; });
		let settled = false;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { id: 'spectra-test', onMessage: { addListener: () => undefined } },
				tabs: { get: async () => ({ id: TAB_ID, title: 'Remote', url: 'https://media.example' }) },
			},
		});
		try {
			setStateCallback(async () => {
				markDeliveryStarted?.();
				await delivery;
			});
			const operation = syncState(TAB_ID, gateway({
				getSnapshot: async () => ({
					tabId: TAB_ID,
					documentId: 'document-delivery-barrier',
					origin: 'https://media.example',
					generation: 9,
					revision: 1,
					activeMedia: null,
					activeVideo: null,
					fields: { volumeBase: field(100), boost: field(1) },
				}),
			})).then(() => { settled = true; });
			await deliveryStarted;
			expect(settled).toBe(false);
			releaseDelivery?.();
			await operation;
			expect(settled).toBe(true);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('rejects a command before admission when its cancellation signal is stale', async () => {
		const abortController = new AbortController();
		abortController.abort('REMOTE_COMMAND_TIMEOUT');
		const submitOperation = mock(async () => operationAck({ volumeBase: field(90) }, 90));

		await expect(executeCommand(
			'volume_down',
			TAB_ID,
			gateway({ submitOperation }),
			abortController.signal,
		)).rejects.toThrow('REMOTE_COMMAND_CANCELLED');
		expect(submitOperation).not.toHaveBeenCalled();
	});

	test('fences a command when cancellation races the control acknowledgement', async () => {
		const abortController = new AbortController();
		const acknowledgement = deferred<ControlOperationAck<'effective-volume'>>();
		let receivedSignal: AbortSignal | undefined;
		const operation = executeCommand(
			'volume_down',
			TAB_ID,
			gateway({
				submitOperation: async (_request, signal) => {
					receivedSignal = signal;
					return acknowledgement.promise;
				},
			}),
			abortController.signal,
		);
		await waitFor(() => receivedSignal !== undefined);
		abortController.abort('REMOTE_COMMAND_TIMEOUT');
		acknowledgement.resolve(operationAck({ volumeBase: field(90) }, 90));

		await expect(operation).rejects.toThrow('REMOTE_COMMAND_CANCELLED');
		expect(receivedSignal?.aborted).toBe(true);
	});

	test('coalesces a blocked state publication to the newest pending snapshot', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const releaseFirst = deferred<void>();
		const firstStarted = deferred<void>();
		const published: number[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { id: 'spectra-test', onMessage: { addListener: () => undefined } },
				tabs: { get: async () => ({ id: TAB_ID, title: 'Remote', url: 'https://media.example' }) },
			},
		});
		try {
			setStateCallback(async (_tabId, state) => {
				published.push(state.revision);
				if (state.revision === 1) {
					firstStarted.resolve();
					await releaseFirst.promise;
				}
			});
			const snapshots: ControlSnapshot[] = [1, 2, 3].map((revision) => ({
				tabId: TAB_ID,
				documentId: 'document-publication-queue',
				origin: 'https://media.example',
				generation: 51,
				revision,
				activeMedia: null,
				activeVideo: null,
				fields: { volumeBase: field(70 + revision), boost: field(1) },
			}));
			let snapshotsRead = 0;
			const control = gateway({
				getSnapshot: async () => {
					snapshotsRead += 1;
					return snapshots.shift() ?? null;
				},
			});
			const first = syncState(TAB_ID, control);
			await firstStarted.promise;
			const second = syncState(TAB_ID, control);
			const third = syncState(TAB_ID, control);
			await waitFor(() => snapshotsRead === 3);
			await new Promise((resolve) => setTimeout(resolve, 0));
			releaseFirst.resolve();
			await Promise.all([first, second, third]);
			expect(published).toEqual([1, 3]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('does not let an obsolete sync failure clear a reused tab projection', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let rejectFirst!: (error: unknown) => void;
		let reads = 0;
		const first = new Promise<ControlSnapshot | null>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const published: number[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { id: 'spectra-test', onMessage: { addListener: () => undefined } },
				tabs: { get: async () => ({ id: TAB_ID, title: 'Remote', url: 'https://media.example' }) },
			},
		});
		try {
			setStateCallback((_tabId, state) => published.push(state.revision));
			const control = gateway({
				getSnapshot: async () => {
					reads += 1;
					if (reads === 1) return first;
					return {
						tabId: TAB_ID,
						documentId: 'reused-document',
						origin: 'https://media.example',
						generation: 1,
						revision: 1,
						activeMedia: null,
						activeVideo: null,
						fields: { volumeBase: field(80), boost: field(1) },
					};
				},
			});
			const obsolete = syncState(TAB_ID, control);
			await waitFor(() => reads === 1);
			invalidateRemoteTab(TAB_ID);
			await syncState(TAB_ID, control);
			rejectFirst(new Error('old document closed'));
			await obsolete;
			expect(published).toEqual([1]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('maps every remote button to one canonical control algorithm and transform', () => {
		expect(Object.keys(REMOTE_COMMAND_DESCRIPTORS).sort()).toEqual([...REMOTE_COMMANDS].sort());
		expect(REMOTE_COMMAND_DESCRIPTORS.volume_up).toEqual({
			capability: 'effective-volume', operation: 'delta', value: 10,
		});
		expect(REMOTE_COMMAND_DESCRIPTORS.volume_max).toEqual({
			capability: 'effective-volume', operation: 'set', value: 800,
		});
	});

	test('publishes background actualConfig/generation without reading desired runtime config', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const snapshot: ControlSnapshot = {
			tabId: TAB_ID,
			documentId: 'document-remote-state',
			origin: 'https://media.example',
			generation: 17,
			revision: 4,
			activeMedia: null,
			activeVideo: null,
			fields: {
				volumeBase: field(100),
				boost: field(1, 'capture', 'full'),
				mediaMuted: field(false),
				playing: field(true),
				speed: field(1.5),
			},
		};
		const getSnapshot = mock(async () => structuredClone(snapshot));
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					onMessage: { addListener: () => undefined },
				},
				tabs: {
					get: async () => ({
						id: TAB_ID,
						title: 'Remote media',
						url: 'https://media.example/watch',
					}),
				},
			},
		});

		try {
			let published: unknown;
			setStateCallback((_tabId, state) => { published = state; });
			await syncState(TAB_ID, gateway({ getSnapshot }));

			expect(published).toEqual({
				generation: 17,
				revision: 4,
				volume: 100,
				volumeBase: 100,
				boost: 1,
				actualMode: 'bypass',
				phase: 'idle',
				volumeState: 'native',
				muted: false,
				playing: true,
				speed: 1.5,
				tabTitle: 'Remote media',
				tabDomain: 'media.example',
			});
			expect(getSnapshot).toHaveBeenCalledTimes(1);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('never publishes an older revision after a newer snapshot wins an async race', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const first = deferred<ControlSnapshot | null>();
		const second = deferred<ControlSnapshot | null>();
		const pendingSnapshots = [first, second];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { id: 'spectra-test', onMessage: { addListener: () => undefined } },
				tabs: { get: async () => ({ id: TAB_ID, title: 'Remote', url: 'https://media.example' }) },
			},
		});
		try {
			const published: Array<import('../src/remote/protocol').RemoteState> = [];
			setStateCallback(async (_tabId, state) => { published.push(state); });
			const control = gateway({
				getSnapshot: async () => (pendingSnapshots.shift()?.promise ?? Promise.resolve(null)),
			});
			const revisionOne = syncState(TAB_ID, control);
			const revisionTwo = syncState(TAB_ID, control);
			second.resolve({
				tabId: TAB_ID, documentId: 'document-race', origin: 'https://media.example',
				generation: 30, revision: 2, activeMedia: null, activeVideo: null,
				fields: { volumeBase: field(90), boost: field(1) },
			});
			await revisionTwo;
			first.resolve({
				tabId: TAB_ID, documentId: 'document-race', origin: 'https://media.example',
				generation: 30, revision: 1, activeMedia: null, activeVideo: null,
				fields: { volumeBase: field(70), boost: field(1) },
			});
			await revisionOne;
			expect(published).toHaveLength(1);
			expect(published[0]).toMatchObject({ generation: 30, revision: 2, volume: 90 });
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('does not resurrect a removed tab projection after an in-flight delivery settles', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const delivery = deferred<void>();
		const deliveryStarted = deferred<void>();
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { id: 'spectra-test', onMessage: { addListener: () => undefined } },
				tabs: { get: async () => ({ id: TAB_ID, title: 'Remote', url: 'https://media.example' }) },
			},
		});
		try {
			const published: number[] = [];
			let first = true;
			setStateCallback(async (_tabId, state) => {
				published.push(state.revision);
				if (!first) return;
				first = false;
				deliveryStarted.resolve();
				await delivery.promise;
			});
			const revisionTwo = syncState(TAB_ID, gateway({
				getSnapshot: async () => ({
					tabId: TAB_ID, documentId: 'removed-document', origin: 'https://media.example',
					generation: 40, revision: 2, activeMedia: null, activeVideo: null,
					fields: { volumeBase: field(90), boost: field(1) },
				}),
			}));
			await deliveryStarted.promise;
			invalidateRemoteTab(TAB_ID);
			delivery.resolve();
			await revisionTwo;

			await syncState(TAB_ID, gateway({
				getSnapshot: async () => ({
					tabId: TAB_ID, documentId: 'reused-document', origin: 'https://media.example',
					generation: 1, revision: 1, activeMedia: null, activeVideo: null,
					fields: { volumeBase: field(70), boost: field(1) },
				}),
			}));
			expect(published).toEqual([2, 1]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('keeps the last applied remote values when a same-document field enters error', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const snapshots: ControlSnapshot[] = [
			{
				tabId: TAB_ID, documentId: 'document-stable', origin: 'https://media.example',
				generation: 21, revision: 7, activeMedia: null, activeVideo: null,
				fields: {
					volumeBase: field(72), boost: field(1.5, 'capture', 'full'),
					mediaMuted: field(true), playing: field(true), speed: field(1.25),
				},
			},
			{
				tabId: TAB_ID, documentId: 'document-stable', origin: 'https://media.example',
				generation: 21, revision: 8, activeMedia: null, activeVideo: null,
				fields: {
					volumeBase: {
						...field(100), actual: null, phase: 'error', strategy: 'unsupported', controlled: false,
						lastError: { code: 'native_write_failed', message: 'Page rejected volume', retryable: true },
					},
					playing: {
						// `applying` was removed from ControlFieldPhase: it had no producer
						// anywhere in src, so the only way to observe it was by hand-writing
						// it here. `idle` carries the same meaning for this test — anything
						// other than `applied` must fall back to the last applied value.
						...field(false), actual: null, phase: 'idle', controlled: false,
					},
				},
			},
		];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test', onMessage: { addListener: () => undefined },
				},
				tabs: {
					get: async () => ({ id: TAB_ID, title: 'Remote media', url: 'https://media.example/watch' }),
				},
			},
		});
		try {
			const published: Array<import('../src/remote/protocol').RemoteState> = [];
			setStateCallback((_tabId, state) => published.push(state));
			const control = gateway({ getSnapshot: async () => structuredClone(snapshots.shift() ?? null) });
			await syncState(TAB_ID, control);
			await syncState(TAB_ID, control);
			expect(published).toHaveLength(2);
			expect(published[1]).toMatchObject({
				generation: 21, volumeBase: 72, boost: 1.5, volume: 108,
				muted: true, playing: true, speed: 1.25,
			});
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('submits one typed effective-volume operation and never calls a legacy media RPC', async () => {
		const requests: unknown[] = [];
		const control = gateway({
			submitOperation: async (request) => {
				requests.push(structuredClone(request));
				return operationAck({ volumeBase: field(90) }, 90);
			},
		});
		expect(await executeCommand('volume_down', TAB_ID, control)).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			tabId: TAB_ID,
			source: 'remote',
			operation: 'effective-volume',
			payload: { operation: 'delta', value: -10 },
		});
	});

	test('rejects a transport-success response whose requested field failed', async () => {
		const control = gateway({
			submitOperation: async () => operationAck({
				volumeBase: {
					...field(90),
					actual: null,
					phase: 'error' as const,
					strategy: 'unsupported' as const,
					controlled: false,
					lastError: {
						code: 'native_write_failed',
						message: 'Page rejected volume',
						retryable: true,
					},
				},
			}, 100),
		});
		await expect(executeCommand('volume_down', TAB_ID, control)).rejects.toThrow('Page rejected volume');
	});
});

function gateway(overrides: Partial<RemoteControlGateway> = {}): RemoteControlGateway {
	return {
		submit: async () => controlAck({}),
		submitOperation: async () => {
			throw new Error('Unexpected remote operation');
		},
		getSnapshot: async () => null,
		...overrides,
	};
}

function controlAck(fields: ControlApplyAck['fields']): ControlApplyAck {
	return {
		intentId: 'remote-intent',
		tabId: TAB_ID,
		documentId: 'document-remote',
		generation: 3,
		revision: 8,
		target: null,
		fields,
	};
}

function operationAck(
	fields: ControlApplyAck['fields'],
	effectiveVolume: number,
): ControlOperationAck<'effective-volume'> {
	const volumeBase = effectiveVolume <= 100 ? effectiveVolume : 100;
	const boost = effectiveVolume <= 100 ? 1 : effectiveVolume / 100;
	return {
		operationId: 'remote-operation',
		tabId: TAB_ID,
		documentId: 'document-remote',
		generation: 3,
		revision: 8,
		target: null,
		operation: 'effective-volume',
		strategy: 'extension-state',
		coverage: boost > 1 ? 'full' : 'active-target',
		fields,
		result: { effectiveVolume, volumeBase, boost },
	};
}

function field<T>(
	actual: T,
	strategy: 'dom-native' | 'capture' = 'dom-native',
	coverage: 'active-target' | 'full' = 'active-target',
) {
	return {
		desired: actual,
		actual,
		revision: 4,
		phase: 'applied' as const,
		strategy,
		coverage,
		controlled: true,
		intentId: 'remote-state',
		lastError: null,
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for remote command admission');
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
