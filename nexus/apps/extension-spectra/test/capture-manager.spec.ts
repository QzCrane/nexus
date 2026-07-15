import { describe, expect, mock, test } from 'bun:test';
import {
	Actions,
	rpcSuccess,
	type AudioCaptureState,
	type AudioConfig,
	type RpcResult,
} from '@nexus/contracts';
import type { NexusMessenger } from '@nexus/kernel';
import { createCaptureManager } from '../src/content/audio/capture-manager';

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
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

describe('capture manager acknowledged state', () => {
	test('waits for ACKs, ignores stale generations, and exposes failures', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const postMessage = mock(() => undefined);
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { postMessage },
		});

		try {
			const startReply = deferred<RpcResult<AudioCaptureState>>();
			const updateReply = deferred<RpcResult<AudioCaptureState>>();
			const stopReply = deferred<RpcResult<AudioCaptureState>>();
			const errorReply = deferred<RpcResult<AudioCaptureState>>();
			const replies = [startReply, updateReply, stopReply, errorReply];
			const send = mock(() => replies.shift()!.promise);
			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { runtime: { id: 'spectra-test', sendMessage: send } },
			});
			const manager = createCaptureManager({ send } as unknown as NexusMessenger);

			const start = manager.request(true, CONFIG, 10);
			expect(manager.getPhase()).toBe('starting');
			expect(manager.isActive()).toBe(false);
			expect(manager.isPending()).toBe(true);
			expect(postMessage).not.toHaveBeenCalled();
			startReply.resolve(rpcSuccess({
				tabId: 9,
				phase: 'active',
				active: true,
				actualMode: 'capture',
				generation: 10,
				lastError: null,
			}));
			await start;
			expect(manager.getPhase()).toBe('active');
			expect(manager.isActive()).toBe(true);
			expect(manager.getGeneration()).toBe(10);

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
			}));
			expect(await sync).toBe(true);
			expect(manager.getGeneration()).toBe(11);

			expect(manager.handleMessage({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { enabled: false, phase: 'idle', generation: 10 },
			})).toBe(true);
			expect(manager.getPhase()).toBe('active');
			expect(manager.isActive()).toBe(true);
			expect(manager.getGeneration()).toBe(11);

			const stop = manager.request(false, CONFIG, 12);
			expect(manager.getPhase()).toBe('stopping');
			expect(manager.isActive()).toBe(true);
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
			expect(postMessage).toHaveBeenCalledWith(
				{ type: 'SPECTRA_CAPTURE_STATE', active: true, generation: 10 },
				'*',
			);
			expect(postMessage).toHaveBeenCalledWith(
				{ type: 'SPECTRA_CAPTURE_STATE', active: false, generation: 12 },
				'*',
			);
			expect(postMessage).toHaveBeenLastCalledWith(
				{ type: 'SPECTRA_CAPTURE_STATE', active: false, generation: 15 },
				'*',
			);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else delete (globalThis as { chrome?: unknown }).chrome;
			if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
			else delete (globalThis as { window?: unknown }).window;
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
