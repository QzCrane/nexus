import { describe, expect, mock, test } from 'bun:test';
import { AudioMode } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG, type AudioConfig } from '@nexus/contracts';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../src/content/types';
import {
	executeMode,
	initModeExecutorCallbacks,
} from '../src/content/logic/mode-executor';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

function cloneConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

describe('mode executor applied configuration', () => {
	test('keeps the prior ACK while Capture starts and reports only DOM capabilities after denial', async () => {
		const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const postMessage = mock(() => undefined);
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {
				location: { hostname: 'media.example' },
				postMessage,
				addEventListener: mock(() => undefined),
			},
		});

		try {
			const desired: AudioConfig = {
				...DEFAULT_AUDIO_CONFIG,
				volume: 200,
				eqValues: [6, 5, 4, 3, 2, 1, -1, -2, -3, -4],
				bass: true,
				compressor: true,
				mono: true,
				pan: 0.75,
				delay: 180,
			};
			const priorApplied = cloneConfig({ ...DEFAULT_AUDIO_CONFIG, volume: 80 });
			const state: PolicyExecutorState = {
				config: desired,
				appliedConfig: priorApplied,
				activeMode: AudioMode.CAPTURE,
				desiredMode: AudioMode.CAPTURE,
				actualMode: 'bypass',
				phase: 'idle',
				generation: 5,
				hasGesture: true,
				userHasInteracted: true,
				isPopupOpen: false,
			};
			const captureReply = deferred<{
				status: 'error';
				phase: 'error';
				active: false;
				generation: number;
				error: string;
			}>();
			const request = mock(() => captureReply.promise);
			const deps = {
				audioController: {
					cleanup: mock(() => undefined),
					initialize: mock(async () => false),
				},
				captureManager: {
					isActive: () => false,
					isPending: () => false,
					request,
					getGeneration: () => 5,
					getLastError: () => 'capture permission denied',
				},
				settingsManager: {},
				policyEngine: {},
			} as unknown as PolicyExecutorDeps;
			const completed = deferred<void>();
			initModeExecutorCallbacks(
				deps,
				state,
				() => undefined,
				() => completed.resolve(),
				() => undefined,
			);

			executeMode(deps, state);
			expect(state.phase).toBe('starting');
			expect(state.appliedConfig).toEqual(priorApplied);

			captureReply.resolve({
				status: 'error',
				phase: 'error',
				active: false,
				generation: 5,
				error: 'capture permission denied',
			});
			await completed.promise;

			expect(state.actualMode).toBe('bypass');
			expect(state.phase).toBe('error');
			expect(state.appliedConfig).toMatchObject({
				volume: 100,
				bass: false,
				compressor: false,
				mono: false,
				pan: 0,
				delay: 0,
			});
			expect(state.appliedConfig.eqValues).toEqual(DEFAULT_AUDIO_CONFIG.eqValues);
			expect(state.appliedConfig).not.toBe(state.config);
			expect(request).toHaveBeenCalledWith(true, desired, 5);
		} finally {
			if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
			else Reflect.deleteProperty(globalThis, 'window');
		}
	});
});
