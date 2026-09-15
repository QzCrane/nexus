import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, rpcSuccess, type AudioConfig } from '@nexus/contracts';
import { persistConfigSnapshot, updateConfig } from '../src/content/logic/policy-executor/config-updater';
import type { InternalState } from '../src/content/logic/policy-executor/types';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../src/content/types';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function config(volume: number): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		volume,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
	};
}

function internalState(): InternalState {
	return {
		corsStatus: 'PENDING',
		lastBadgeHash: '',
		lastSyncHash: '',
	};
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe('content config persistence queue', () => {
	test('serializes concurrent snapshots and preserves the final value', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const first = deferred<unknown>();
		const second = deferred<unknown>();
		const messages: Array<Record<string, unknown>> = [];
		const sendMessage = mock((message: Record<string, unknown>) => {
			messages.push(message);
			return messages.length === 1 ? first.promise : second.promise;
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage } },
		});

		try {
			const state = internalState();
			const firstConfig = config(110);
			const firstResult = persistConfigSnapshot(state, firstConfig, 7);
			firstConfig.volume = 799;
			firstConfig.eqValues[0] = 99;
			const secondResult = persistConfigSnapshot(state, config(125), 8);

			await settle();
			expect(sendMessage).toHaveBeenCalledTimes(1);
			expect((messages[0].payload as { config: AudioConfig }).config.volume).toBe(110);
			expect((messages[0].payload as { config: AudioConfig }).config.eqValues[0]).toBe(
				DEFAULT_AUDIO_CONFIG.eqValues[0],
			);

			first.resolve(rpcSuccess({ saved: true as const }));
			expect((await firstResult).ok).toBe(true);
			await settle();
			expect(sendMessage).toHaveBeenCalledTimes(2);
			expect((messages[1].payload as { config: AudioConfig }).config.volume).toBe(125);

			second.resolve(rpcSuccess({ saved: true as const }));
			expect((await secondResult).ok).toBe(true);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('reports a failed write but still advances the queue to the newest snapshot', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const first = deferred<unknown>();
		const messages: Array<Record<string, unknown>> = [];
		const sendMessage = mock((message: Record<string, unknown>) => {
			messages.push(message);
			return messages.length === 1
				? first.promise
				: Promise.resolve(rpcSuccess({ saved: true as const }));
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage } },
		});

		try {
			const state = internalState();
			const failedResult = persistConfigSnapshot(state, config(130), 9);
			const finalResult = persistConfigSnapshot(state, config(140), 10);
			await settle();
			expect(sendMessage).toHaveBeenCalledTimes(1);

			first.reject(new Error('worker restarted'));
			const failure = await failedResult;
			expect(failure).toEqual({
				ok: false,
				error: {
					code: 'audio_config_persist_failed',
					message: 'worker restarted',
					retryable: true,
				},
			});
			await settle();
			expect(sendMessage).toHaveBeenCalledTimes(2);
			expect((messages[1].payload as { config: AudioConfig }).config.volume).toBe(140);
			expect((await finalResult).ok).toBe(true);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('deferPersistence ACKs the applied state before the durability write settles', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const gate = deferred<unknown>();
		const messages: Array<Record<string, unknown>> = [];
		const sendMessage = mock((message: Record<string, unknown>) => {
			messages.push(message);
			return message.type === 'spectra.audio.config.set'
				? gate.promise
				: Promise.resolve(rpcSuccess({ saved: true as const }));
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage } },
		});

		try {
			const state: PolicyExecutorState = {
				config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				mediaRoute: 'auto',
				appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				activeMode: 'bypass',
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 2,
				userHasInteracted: false,
				isPopupOpen: false,
				visualizerSubscribers: new Set(),
				processorHold: false,
			};
			const deps = { captureManager: { isActive: () => false } } as unknown as PolicyExecutorDeps;
			const internal = internalState();
			const applyStateFn = mock(async () => undefined);

			const result = updateConfig(
				deps,
				state,
				internal,
				{ boost: 2, volumeBase: 100, volume: 200 },
				{ deferPersistence: true },
				applyStateFn,
			);

			// The policy is applied and the ACK resolves without waiting for the
			// durability write, which is still in flight behind the gate.
			const acknowledgement = await result;
			expect(acknowledgement.ok).toBe(true);
			expect(acknowledgement.data.saved).toBe(true);
			expect(applyStateFn).toHaveBeenCalledTimes(1);
			await settle();
			expect(messages.filter((m) => m.type === 'spectra.audio.config.set')).toHaveLength(1);

			// A failed durability write must not reject the already-acknowledged
			// applied state; the next update supersedes it.
			gate.reject(new Error('worker restarted'));
			await settle();
			expect(messages.filter((m) => m.type === 'spectra.audio.config.set')).toHaveLength(1);
			expect(state.config.boost).toBe(2);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
