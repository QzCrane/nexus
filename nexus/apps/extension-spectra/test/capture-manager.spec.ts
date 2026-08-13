import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
	Actions,
	rpcSuccess,
	type AudioCaptureState,
	type AudioConfig,
	type RpcResult,
} from '@nexus/contracts';
import type { NexusMessenger } from '@nexus/kernel';
import {
	createCaptureManager,
	resetCaptureManagerForTests,
} from '../src/content/audio/capture-manager';
import { requireValue } from './helpers/require-value';

const CONFIG: AudioConfig = {
	enabled: true,
	volume: 100,
	muted: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	bass: false,
	compressor: false,
	mono: false,
	pan: 0,
	delay: 0,
	speed: 1,
	preservePitch: true,
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

beforeEach(() => resetCaptureManagerForTests());

describe('capture manager acknowledged state', () => {
	test('mints a one-shot continuation only from an acknowledged active Capture', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		try {
			const replies = [
				rpcSuccess({
					tabId: 9, phase: 'active', active: true, actualMode: 'capture',
					generation: 20, lastError: null, actualConfig: CONFIG,
				} satisfies AudioCaptureState),
				rpcSuccess({
					tabId: 9, phase: 'idle', active: false, actualMode: 'bypass',
					generation: 21, lastError: null,
				} satisfies AudioCaptureState),
				rpcSuccess({
					tabId: 9, phase: 'active', active: true, actualMode: 'capture',
					generation: 22, lastError: null, actualConfig: CONFIG,
				} satisfies AudioCaptureState),
				rpcSuccess({
					tabId: 9, phase: 'idle', active: false, actualMode: 'bypass',
					generation: 23, lastError: null,
				} satisfies AudioCaptureState),
			];
			const send = mock(async () => requireValue(
				replies.shift(),
				'Capture manager sent more requests than the fixture provides',
			));
			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { runtime: { id: 'spectra-test', sendMessage: send } },
			});
			const manager = createCaptureManager({ send } as unknown as NexusMessenger);
			await manager.request(true, CONFIG, 20);
			const continuation = await manager.suspendForContinuation(CONFIG, 21);
			expect(manager.isActive()).toBe(false);
			expect(continuation).not.toBeNull();
			const resumable = requireValue(
				continuation,
				'Expected acknowledged capture suspension to mint a continuation',
			);
			await resumable.resume(CONFIG, 22);
			expect(manager.isActive()).toBe(true);
			await expect(resumable.resume(CONFIG, 23)).rejects.toThrow('already consumed');
			expect(send).toHaveBeenCalledTimes(3);
			await manager.request(false, CONFIG, 23);
			expect(manager.isActive()).toBe(false);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else delete (globalThis as { chrome?: unknown }).chrome;
		}
	});

	test('waits for ACKs, ignores stale generations, and exposes failures', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

		try {
			const startReply = deferred<RpcResult<AudioCaptureState>>();
			const updateReply = deferred<RpcResult<AudioCaptureState>>();
			const stopReply = deferred<RpcResult<AudioCaptureState>>();
			const errorReply = deferred<RpcResult<AudioCaptureState>>();
			const replies = [startReply, updateReply, stopReply, errorReply];
			const send = mock(() => requireValue(
				replies.shift(),
				'Capture manager sent more requests than the deferred fixture provides',
			).promise);
			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { runtime: { id: 'spectra-test', sendMessage: send } },
			});
			const manager = createCaptureManager({ send } as unknown as NexusMessenger);

			const start = manager.request(true, CONFIG, 10);
			expect(manager.getPhase()).toBe('starting');
			expect(manager.isActive()).toBe(false);
			expect(manager.isPending()).toBe(true);
			startReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				generation: 10,
				lastError: null,
				actualConfig: CONFIG,
			}));
			await start;
			expect(manager.getPhase()).toBe('active');
			expect(manager.isActive()).toBe(true);
			expect(manager.getGeneration()).toBe(10);
			const eventActual = { ...CONFIG, volume: 120, volumeBase: 100, boost: 1.2 };
			expect(manager.handleMessage({
				protocolVersion: 2,
				type: 'spectra.audio.capture.changed',
				tabId: 9,
				documentId: 'document-9',
				generation: 10,
				payload: {
					tabId: 9,
					phase: 'active',
					active: true,
					actualMode: 'capture',
					generation: 10,
					lastError: null,
					actualConfig: eventActual,
				},
			})).toBe(true);
			expect(manager.getActualConfig()).toEqual(eventActual);

			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: false, phase: 'starting', generation: 10 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('active');
			expect(manager.isActive()).toBe(true);

			const sync = manager.syncConfig(CONFIG, 11);
			expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
				protocolVersion: 2,
				type: 'spectra.audio.capture.config',
				payload: { config: CONFIG },
				generation: 11,
			}));
			updateReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				generation: 11,
				lastError: null,
				actualConfig: CONFIG,
			}));
			expect(await sync).toEqual(CONFIG);
			expect(manager.getGeneration()).toBe(11);
			const staleActual = { ...CONFIG, volume: 70, volumeBase: 70, boost: 1 };
			expect(manager.handleMessage({
				protocolVersion: 2,
				type: 'spectra.audio.capture.changed',
				tabId: 9,
				documentId: 'document-9',
				generation: 10,
				payload: {
					tabId: 9,
					phase: 'active',
					active: true,
					actualMode: 'capture',
					generation: 10,
					lastError: null,
					actualConfig: staleActual,
				},
			})).toBe(true);
			expect(manager.getActualConfig()).toEqual(CONFIG);
			manager.restoreState({
				active: true,
				phase: 'starting',
				generation: 11,
				actualConfig: staleActual,
			});
			expect(manager.getPhase()).toBe('active');
			expect(manager.getActualConfig()).toEqual(CONFIG);

			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: false, phase: 'idle', generation: 10 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('active');
			expect(manager.isActive()).toBe(true);
			expect(manager.getGeneration()).toBe(11);

			// A caller can still hold the currently acknowledged generation. Changing
			// processor ownership must allocate the next generation instead of trying
			// to reuse the active generation for a contradictory stop transition.
			const stop = manager.request(false, CONFIG, 11);
			expect(manager.getPhase()).toBe('stopping');
			expect(manager.isActive()).toBe(true);
			expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
				type: 'spectra.audio.capture.set',
				generation: 12,
				payload: { enabled: false, config: CONFIG },
			}));
			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: true, phase: 'stopping', generation: 12 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('stopping');
			expect(manager.isActive()).toBe(true);
			stopReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'idle',
				active: false,
				actualMode: 'bypass',
				generation: 12,
				lastError: null,
			}));
			await stop;
			expect(manager.getPhase()).toBe('idle');
			expect(manager.isActive()).toBe(false);
			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: true, phase: 'stopping', generation: 12 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('idle');
			expect(manager.isActive()).toBe(false);

			const failed = manager.request(true, CONFIG, 13);
			expect(manager.getPhase()).toBe('starting');
			errorReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'error',
				active: false,
				actualMode: 'bypass',
				generation: 13,
				lastError: {
					code: 'capture_error',
					message: 'capture permission denied',
					retryable: true,
				},
			}));
			await failed;
			expect(manager.getPhase()).toBe('error');
			expect(manager.isActive()).toBe(false);
			expect(manager.getLastError()).toBe('capture permission denied');
			expect(manager.isPending()).toBe(false);
			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: false, phase: 'starting', generation: 13 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('error');

			const delayedStartReply = deferred<RpcResult<AudioCaptureState>>();
			const stopAfterStartReply = deferred<RpcResult<AudioCaptureState>>();
			replies.push(delayedStartReply, stopAfterStartReply);
			const delayedStart = manager.request(true, CONFIG, 14);
			const stopAfterStart = manager.request(false, CONFIG, 15);
			expect(send).toHaveBeenCalledTimes(5);
			delayedStartReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				generation: 14,
				lastError: null,
			}));
			await delayedStart;
			await waitFor(() => send.mock.calls.length === 6);
			stopAfterStartReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'idle',
				active: false,
				actualMode: 'bypass',
				generation: 15,
				lastError: null,
			}));
			await stopAfterStart;
			expect(manager.isActive()).toBe(false);
			expect(manager.getGeneration()).toBe(15);
			expect(send).toHaveBeenCalledTimes(6);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else delete (globalThis as { chrome?: unknown }).chrome;
		}
	});
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}
