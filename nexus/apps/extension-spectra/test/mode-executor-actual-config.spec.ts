import { describe, expect, mock, test } from 'bun:test';
import { AudioMode, audioGraphSignature } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG, type AudioConfig } from '@nexus/contracts';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../src/content/types';
import type { MediaRegistry } from '../src/content/core/media-registry';
import { setActiveMediaRegistry } from '../src/content/core/media-registry';
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
			await Promise.resolve();
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

	test('activates Media WebAudio only after every safe registry source is attached', async () => {
		const globals = installCoverageGlobals();
		const first = media('https://media.example/first.mp3');
		const second = media('https://media.example/second.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [
				{ element: first, target: {} },
				{ element: second, target: {} },
			],
		} as unknown as MediaRegistry);
		const ensureAttached = mock(() => true);
		const state = webAudioState();
		const normalizedActualConfig = {
			boostGain: 2,
			bass: false,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			compressor: false,
			mono: false,
			pan: 0,
			delay: 0,
		};
		const deps = {
			audioController: {
				cleanup: mock(async () => undefined),
				initialize: mock(async () => true),
				ensureAttached,
				hasCompleteCoverage: mock(() => true),
				applyConfig: mock(async () => ({
					phase: 'active',
					contextState: 'running',
					sourceCount: 2,
					outputChannels: 2,
					graphSignature: 'bass:0|eq:-|compressor:0|mono:0|pan:0|delay:0',
					normalizedActualConfig,
				})),
			},
			captureManager: inactiveCaptureManager(),
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;
		try {
			await executeMode(deps, state);
			expect(ensureAttached).toHaveBeenCalledTimes(2);
			expect(ensureAttached).toHaveBeenNthCalledWith(1, first, undefined);
			expect(ensureAttached).toHaveBeenNthCalledWith(2, second, undefined);
			expect(state.actualMode).toBe('webaudio');
			expect(state.phase).toBe('active');
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});

	test('a newly registered unsafe source cannot leave partial WebAudio reported active', async () => {
		const globals = installCoverageGlobals();
		const safe = media('https://media.example/first.mp3');
		const unsafe = media('https://cdn.example/second.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [
				{ element: safe, target: {} },
				{ element: unsafe, target: {} },
			],
		} as unknown as MediaRegistry);
		const initialize = mock(async () => true);
		const state = webAudioState();
		state.actualMode = 'webaudio';
		state.phase = 'active';
		const deps = {
			audioController: {
				cleanup: mock(async () => undefined),
				initialize,
			},
			captureManager: inactiveCaptureManager(),
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;
		try {
			await executeMode(deps, state);
			// rule: Coverage failure with an active processor need escalates to
			// Capture (SCTRL-011). The processor is never left partially applied
			// through WebAudio, but Capture denial still surfaces as bypass+error.
			expect(initialize).not.toHaveBeenCalled();
			expect(state.actualMode).toBe('bypass');
			expect(state.phase).toBe('error');
			expect(state.lastError).toBe('capture permission denied');
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});

	test('falls back to Capture when WebAudio coverage fails with active processor need', async () => {
		const globals = installCoverageGlobals();
		const safe = media('https://media.example/first.mp3');
		const unsafe = media('https://cdn.example/second.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [
				{ element: safe, target: {} },
				{ element: unsafe, target: {} },
			],
		} as unknown as MediaRegistry);
		const initialize = mock(async () => true);
		const state = webAudioState();
		state.actualMode = 'webaudio';
		state.phase = 'active';
		const capturedActual = cloneConfig({ ...DEFAULT_AUDIO_CONFIG, boost: 2, volume: 200 });
		const request = mock(async () => ({
			status: 'active' as const,
			phase: 'active' as const,
			active: true,
			generation: 7,
			actualConfig: capturedActual,
		}));
		const deps = {
			audioController: {
				cleanup: mock(async () => undefined),
				initialize,
			},
			captureManager: {
				isActive: () => false,
				isPending: () => false,
				request,
				getGeneration: () => 7,
				getLastError: () => undefined,
				getActualConfig: () => capturedActual,
			},
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;
		try {
			await executeMode(deps, state);
			// rule: when WebAudio coverage fails but a processor is explicitly
			// needed (volume > 100, EQ, etc.), Capture becomes the last-resort
			// full-output path because tabCapture is not blocked by page CORS.
			expect(initialize).not.toHaveBeenCalled();
			expect(request).toHaveBeenCalledWith(true, state.config, 4);
			expect(state.actualMode).toBe('capture');
			expect(state.phase).toBe('active');
			expect(state.lastError).toBeUndefined();
			expect(state.appliedConfig).toEqual(capturedActual);
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});

	test('keeps WebAudio bypass when coverage fails without a processor need', async () => {
		const globals = installCoverageGlobals();
		const safe = media('https://media.example/first.mp3');
		const unsafe = media('https://cdn.example/second.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [
				{ element: safe, target: {} },
				{ element: unsafe, target: {} },
			],
		} as unknown as MediaRegistry);
		const initialize = mock(async () => true);
		const state = webAudioState();
		// rule: a transparent config (no boost, no DSP) does not justify the
		// activation-bound Capture path; bypass reports the coverage gap directly.
		state.config = cloneConfig(DEFAULT_AUDIO_CONFIG);
		state.appliedConfig = cloneConfig(DEFAULT_AUDIO_CONFIG);
		state.actualMode = 'webaudio';
		state.phase = 'active';
		const request = mock(async () => ({
			status: 'active' as const,
			phase: 'active' as const,
			active: true,
			generation: 7,
		}));
		const deps = {
			audioController: {
				cleanup: mock(async () => undefined),
				initialize,
			},
			captureManager: {
				isActive: () => false,
				isPending: () => false,
				request,
				getGeneration: () => 7,
				getLastError: () => undefined,
				getActualConfig: () => null,
			},
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;
		try {
			await executeMode(deps, state);
			expect(initialize).not.toHaveBeenCalled();
			expect(request).not.toHaveBeenCalled();
			expect(state.actualMode).toBe('bypass');
			expect(state.phase).toBe('error');
			expect(state.lastError).toBe('Media WebAudio coverage is unsafe');
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});

	test('neutralizes Media WebAudio before Capture and restores the stable graph after candidate failure', async () => {
		const globals = installCoverageGlobals();
		const source = media('https://media.example/restore.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [{ element: source, target: {} }],
		} as unknown as MediaRegistry);
		const order: string[] = [];
		const state = webAudioState();
		state.activeMode = AudioMode.CAPTURE;
		state.desiredMode = AudioMode.CAPTURE;
		state.actualMode = 'webaudio';
		state.phase = 'active';
		const normalizedActualConfig = {
			boostGain: 2,
			bass: false,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			compressor: false,
			mono: false,
			pan: 0,
			delay: 0,
		};
		const deps = {
			audioController: {
				cleanup: mock(async () => { order.push('webaudio:unity'); }),
				initialize: mock(async () => {
					order.push('webaudio:restore');
					return true;
				}),
				ensureAttached: mock(() => true),
				hasCompleteCoverage: mock(() => true),
				applyConfig: mock(async () => {
					order.push('webaudio:actual');
					return {
						phase: 'active' as const,
						contextState: 'running' as const,
						sourceCount: 1,
						outputChannels: 2,
						graphSignature: audioGraphSignature(normalizedActualConfig),
						normalizedActualConfig,
					};
				}),
			},
			captureManager: {
				isActive: () => false,
				isPending: () => false,
				request: mock(async () => {
					order.push('capture:candidate');
					return {
						status: 'error' as const,
						phase: 'error' as const,
						active: false,
						generation: 4,
						error: 'capture denied',
					};
				}),
				getGeneration: () => 4,
				getLastError: () => 'capture denied',
			},
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;

		try {
			await executeMode(deps, state);

			expect(order).toEqual([
				'webaudio:unity',
				'capture:candidate',
				'webaudio:restore',
				'webaudio:actual',
			]);
			expect(state.actualMode).toBe('webaudio');
			expect(state.phase).toBe('error');
			expect(state.appliedConfig.boost).toBe(2);
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});

	test('uses Capture as a unity relay until the complete Media WebAudio graph is verified', async () => {
		const globals = installCoverageGlobals();
		const source = media('https://media.example/relay.mp3');
		const disposeRegistry = setActiveMediaRegistry({
			list: () => [{ element: source, target: {} }],
		} as unknown as MediaRegistry);
		const order: string[] = [];
		const state = webAudioState();
		state.actualMode = 'capture';
		state.phase = 'active';
		const normalizedActualConfig = {
			boostGain: 2,
			bass: false,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			compressor: false,
			mono: false,
			pan: 0,
			delay: 0,
		};
		const deps = {
			audioController: {
				cleanup: mock(async () => undefined),
				initialize: mock(async () => {
					order.push('webaudio:initialize');
					return true;
				}),
				ensureAttached: mock(() => {
					order.push('webaudio:attach');
					return true;
				}),
				hasCompleteCoverage: mock(() => true),
				applyConfig: mock(async () => {
					order.push('webaudio:actual');
					return {
						phase: 'active' as const,
						contextState: 'running' as const,
						sourceCount: 1,
						outputChannels: 2,
						graphSignature: audioGraphSignature(normalizedActualConfig),
						normalizedActualConfig,
					};
				}),
			},
			captureManager: {
				isActive: () => true,
				isPending: () => false,
				syncConfig: mock(async (config: AudioConfig) => {
					order.push('capture:unity');
					return cloneConfig(config);
				}),
				request: mock(async (enabled: boolean) => {
					expect(enabled).toBe(false);
					order.push('capture:stop');
					return {
						status: 'processing' as const,
						phase: 'idle' as const,
						active: false,
						generation: 4,
					};
				}),
				getGeneration: () => 4,
				getLastError: () => undefined,
			},
			settingsManager: {},
			policyEngine: {},
		} as unknown as PolicyExecutorDeps;

		try {
			await executeMode(deps, state);
			expect(order).toEqual([
				'capture:unity',
				'webaudio:initialize',
				'webaudio:attach',
				'webaudio:actual',
				'capture:stop',
			]);
			expect(state.actualMode).toBe('webaudio');
			expect(state.phase).toBe('active');
		} finally {
			disposeRegistry();
			globals.restore();
		}
	});
});

function webAudioState(): PolicyExecutorState {
	const config = cloneConfig({ ...DEFAULT_AUDIO_CONFIG, boost: 2, volume: 200 });
	return {
		config,
		appliedConfig: cloneConfig(DEFAULT_AUDIO_CONFIG),
		activeMode: AudioMode.NATIVE_WEBAUDIO,
		desiredMode: AudioMode.NATIVE_WEBAUDIO,
		actualMode: 'bypass',
		phase: 'idle',
		generation: 4,
		hasGesture: true,
		userHasInteracted: true,
		isPopupOpen: false,
	};
}

function inactiveCaptureManager() {
	return {
		isActive: () => false,
		isPending: () => false,
		getGeneration: () => 4,
		getLastError: () => undefined,
		request: mock(async () => ({
			status: 'error' as const,
			phase: 'error' as const,
			active: false,
			generation: 4,
			error: 'capture permission denied',
		})),
		getActualConfig: () => null,
	};
}

function media(currentSrc: string): HTMLMediaElement {
	return { currentSrc, src: currentSrc } as HTMLMediaElement;
}

function installCoverageGlobals(): { restore(): void } {
	const descriptors = new Map([
		['document', Object.getOwnPropertyDescriptor(globalThis, 'document')],
		['location', Object.getOwnPropertyDescriptor(globalThis, 'location')],
	] as const);
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { baseURI: 'https://media.example/watch' },
	});
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { href: 'https://media.example/watch', origin: 'https://media.example' },
	});
	return {
		restore() {
			for (const [key, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}
