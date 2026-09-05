import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	audioConfigToProcessorConfig,
	DEFAULT_AUDIO_CONFIG,
	type AudioConfig,
	type CaptureAdmission,
} from '@nexus/contracts';
import { audioGraphSignature } from '@nexus/audio-engine';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../src/content/types';
import {
	createModeExecutor,
	type ModeExecutor,
} from '../src/content/logic/mode-executor';
import { createCaptureAdmission } from './helpers/capture-admission';

const ADMISSION = createCaptureAdmission();
let disposeCallbacks: (() => void) | null = null;
let currentExecutor: ModeExecutor | null = null;

afterEach(() => {
	disposeCallbacks?.();
	disposeCallbacks = null;
	currentExecutor = null;
});

function clone(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function processorConfig(): AudioConfig {
	return clone({
		...DEFAULT_AUDIO_CONFIG,
		volume: 200,
		boost: 2,
		eqValues: [6, 5, 4, 3, 2, 1, -1, -2, -3, -4],
		bass: true,
		compressor: true,
		mono: true,
		pan: 0.75,
		delay: 180,
	});
}

function state(mode: 'bypass' | 'webaudio' | 'capture' = 'capture'): PolicyExecutorState {
	return {
		config: processorConfig(),
		appliedConfig: clone(DEFAULT_AUDIO_CONFIG),
		activeMode: mode,
		desiredMode: mode,
		actualMode: 'bypass',
		phase: 'idle',
		generation: 5,
		userHasInteracted: true,
		isPopupOpen: false,
		visualizerSubscribers: new Set(),
	};
}

function deps(
	overrides: Partial<PolicyExecutorDeps['captureManager']> = {},
	audioOverrides: Record<string, unknown> = {},
	media: HTMLMediaElement[] = [],
): PolicyExecutorDeps {
	return {
		captureManager: {
			isActive: () => false,
			isPending: () => false,
			waitForSettled: async () => undefined,
			rehydrateActiveSession: async () => null,
			request: mock(async () => ({
				status: 'error' as const,
				phase: 'error' as const,
				active: false,
				generation: 5,
				error: 'capture permission denied',
			})),
			syncConfig: mock(async () => null),
			getGeneration: () => 5,
			getLastError: () => 'capture permission denied',
			getActualConfig: () => null,
			...overrides,
		} as PolicyExecutorDeps['captureManager'],
		audioController: {
			setVisualizerSubscribed: mock(() => false),
			isReady: () => false,
			bypass: mock(async () => undefined),
			canAttachAll: () => false,
			initialize: mock(async () => false),
			ensureAttached: () => false,
			hasCompleteCoverage: () => false,
			applyConfig: mock(async () => { throw new Error('unconfigured WebAudio test'); }),
			...audioOverrides,
		} as unknown as PolicyExecutorDeps['audioController'],
		mediaRegistry: {
			list: () => media.map((element, index) => ({
				element,
				target: {
					frameId: 0,
					documentId: 'document-test',
					mediaId: `media:${index + 1}`,
					sourceRevision: 0,
					kind: 'audio' as const,
				},
			})),
			getEligibilityEvidence: () => undefined,
		} as unknown as PolicyExecutorDeps['mediaRegistry'],
		settingsManager: {} as PolicyExecutorDeps['settingsManager'],
		lifecycleSignal: new AbortController().signal,
	};
}

function bindCallbacks(runtimeDeps: PolicyExecutorDeps, runtimeState: PolicyExecutorState): void {
	currentExecutor = createModeExecutor(
		runtimeDeps,
		runtimeState,
		() => undefined,
		() => undefined,
	);
	disposeCallbacks = () => currentExecutor?.dispose();
}

function executeMode(
	_deps: PolicyExecutorDeps,
	_state: PolicyExecutorState,
	advanceGeneration = false,
	captureAdmission?: CaptureAdmission,
): Promise<void> {
	if (!currentExecutor) throw new Error('Mode executor is not bound');
	return currentExecutor.execute(advanceGeneration, captureAdmission);
}

describe('three-owner audio mode executor', () => {
	test('keeps a proven >100 media source in the lower-cost page WebAudio owner', async () => {
		const runtimeState = state('webaudio');
		const media = {} as HTMLMediaElement;
		const graphConfig = audioConfigToProcessorConfig(runtimeState.config);
		const request = mock(async () => { throw new Error('Capture must not start'); });
		const runtimeDeps = deps({ request }, {
			canAttachAll: () => true,
			initialize: mock(async () => true),
			ensureAttached: () => true,
			hasCompleteCoverage: () => true,
			applyConfig: mock(async () => ({
				phase: 'active' as const,
				contextState: 'running' as const,
				graphSignature: audioGraphSignature(graphConfig),
				normalizedActualConfig: graphConfig,
				outputChannels: 2,
				sourceCount: 1,
			})),
		}, [media]);
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, true, ADMISSION);

		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'webaudio', phase: 'active' });
		expect(runtimeState.appliedConfig.volume).toBe(200);
		expect(runtimeState.appliedConfig.boost).toBe(2);
	});

	test('uses the same page graph as a neutral analyser for a 0-100 visualizer', async () => {
		const runtimeState = state('webaudio');
		runtimeState.config = clone(DEFAULT_AUDIO_CONFIG);
		runtimeState.visualizerSubscribers.add('popup-visualizer');
		const media = {} as HTMLMediaElement;
		const graphConfig = audioConfigToProcessorConfig(runtimeState.config);
		const setVisualizerSubscribed = mock(() => true);
		const request = mock(async () => { throw new Error('Capture must not start'); });
		const runtimeDeps = deps({ request }, {
			canAttachAll: () => true,
			initialize: mock(async () => true),
			ensureAttached: () => true,
			hasCompleteCoverage: () => true,
			setVisualizerSubscribed,
			applyConfig: mock(async () => ({
				phase: 'active' as const,
				contextState: 'running' as const,
				graphSignature: audioGraphSignature(graphConfig),
				normalizedActualConfig: graphConfig,
				outputChannels: 2,
				sourceCount: 1,
			})),
		}, [media]);
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, true, ADMISSION);

		expect(request).not.toHaveBeenCalled();
		expect(setVisualizerSubscribed).toHaveBeenCalledWith(true);
		expect(runtimeState).toMatchObject({ actualMode: 'webaudio', phase: 'active' });
		expect(runtimeState.appliedConfig.boost).toBe(1);
	});

	test('never escalates a direct route to Capture when the page graph is unavailable', async () => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const runtimeDeps = deps({ request }, { canAttachAll: () => false });
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'bypass', phase: 'error' });
		expect(runtimeState.lastError).toContain('Direct route cannot bind');
	});
	test('never turns page interaction into Capture authority', async () => {
		const runtimeState = state();
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const runtimeDeps = deps({ request });
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState);

		expect(request).not.toHaveBeenCalled();
		expect(runtimeState.actualMode).toBe('bypass');
		expect(runtimeState.phase).toBe('error');
		expect(runtimeState.lastError).toBe('Capture requires a current-tab extension invocation');
		expect(runtimeState.appliedConfig.boost).toBe(1);
	});

	test('publishes processor state only from an admitted active ACK', async () => {
		const runtimeState = state();
		const actual = processorConfig();
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: actual,
		}));
		const runtimeDeps = deps({ request, getActualConfig: () => actual });
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(request).toHaveBeenCalledWith(true, runtimeState.config, 5, { admission: ADMISSION });
		expect(runtimeState.actualMode).toBe('capture');
		expect(runtimeState.phase).toBe('active');
		expect(runtimeState.generation).toBe(6);
		expect(runtimeState.appliedConfig).toEqual(actual);
	});

	test('reports a denied start as native bypass without claiming DSP', async () => {
		const runtimeState = state();
		const runtimeDeps = deps();
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(runtimeState.actualMode).toBe('bypass');
		expect(runtimeState.phase).toBe('error');
		expect(runtimeState.appliedConfig).toMatchObject({
			volume: 100,
			boost: 1,
			bass: false,
			compressor: false,
			mono: false,
			pan: 0,
			delay: 0,
		});
		expect(runtimeState.appliedConfig.eqValues).toEqual(DEFAULT_AUDIO_CONFIG.eqValues);
	});

	test('updates an existing Capture and retains its last ACK when update fails', async () => {
		const runtimeState = state();
		const prior = processorConfig();
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = prior;
		const syncConfig = mock(async () => null);
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig,
			getGeneration: () => 7,
			getLastError: () => 'graph update failed',
		});
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState);

		expect(syncConfig).toHaveBeenCalledWith(runtimeState.config, 5);
		expect(runtimeState.actualMode).toBe('capture');
		expect(runtimeState.phase).toBe('error');
		expect(runtimeState.lastError).toBe('graph update failed');
		expect(runtimeState.appliedConfig).toEqual(prior);
	});

	test('rehydrates an acknowledged active processor before the first post-restart update', async () => {
		const runtimeState = state();
		const actual = processorConfig();
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = actual;
		let restored = false;
		const rehydrateActiveSession = mock(async () => {
			restored = true;
			return { generation: 8, actualConfig: actual };
		});
		const syncConfig = mock(async () => actual);
		const request = mock(async () => ({
			status: 'error' as const,
			phase: 'error' as const,
			active: false,
			generation: 5,
		}));
		const runtimeDeps = deps({
			isActive: () => restored,
			rehydrateActiveSession,
			syncConfig,
			request,
			getActualConfig: () => actual,
		});
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState);

		expect(rehydrateActiveSession).toHaveBeenCalledTimes(1);
		expect(syncConfig).toHaveBeenCalledWith(runtimeState.config, 8);
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({
			actualMode: 'capture',
			phase: 'active',
			generation: 8,
		});
	});

	test('neutralizes Capture before stop and exposes a retained physical owner', async () => {
		const runtimeState = state('bypass');
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		const transparent = clone(DEFAULT_AUDIO_CONFIG);
		const syncConfig = mock(async () => transparent);
		const request = mock(async () => ({
			status: 'error' as const,
			phase: 'error' as const,
			active: true,
			generation: 6,
			error: 'stop acknowledgement lost',
		}));
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig,
			request,
		});
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState);

		expect(syncConfig).toHaveBeenCalledWith(DEFAULT_AUDIO_CONFIG, 5);
		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 5);
		expect(runtimeState.actualMode).toBe('capture');
		expect(runtimeState.phase).toBe('error');
		expect(runtimeState.appliedConfig).toEqual(transparent);
	});

	test('does not commit a late Capture ACK after the mode executor is disposed', async () => {
		const runtimeState = state();
		const reply = deferred<{
			status: 'processing';
			phase: 'active';
			active: true;
			generation: number;
			actualConfig: AudioConfig;
		}>();
		const request = mock(async () => reply.promise);
		const runtimeDeps = deps({ request });
		bindCallbacks(runtimeDeps, runtimeState);

		const transition = executeMode(runtimeDeps, runtimeState, false, ADMISSION);
		await Promise.resolve();
		expect(request).toHaveBeenCalledTimes(1);
		disposeCallbacks?.();
		reply.resolve({
			status: 'processing',
			phase: 'active',
			active: true,
			generation: 6,
			actualConfig: processorConfig(),
		});
		await transition;

		expect(runtimeState.actualMode).toBe('bypass');
		// The in-flight transition had already entered `starting` before the
		// runtime was disposed; the important fence is that the late ACK cannot
		// promote it to active or advance the generation.
		expect(runtimeState.phase).toBe('starting');
		expect(runtimeState.generation).toBe(5);
	});

	test('keeps a replacement document executor independent from a retiring executor', async () => {
		const oldState = state();
		const oldReply = deferred<{
			status: 'processing';
			phase: 'active';
			active: true;
			generation: number;
			actualConfig: AudioConfig;
		}>();
		const oldRequest = mock(async () => oldReply.promise);
		const oldExecutor = createModeExecutor(
			deps({ request: oldRequest }),
			oldState,
			() => undefined,
			() => undefined,
		);
		const oldTransition = oldExecutor.execute(false, ADMISSION);
		await Promise.resolve();
		expect(oldRequest).toHaveBeenCalledTimes(1);

		oldExecutor.dispose();
		const newState = state();
		const newActual = processorConfig();
		const newRequest = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 9,
			actualConfig: newActual,
		}));
		const newBadge = mock(() => undefined);
		const newExecutor = createModeExecutor(
			deps({ request: newRequest, getActualConfig: () => newActual }),
			newState,
			newBadge,
			() => undefined,
		);
		await newExecutor.execute(false, ADMISSION);

		oldReply.resolve({
			status: 'processing',
			phase: 'active',
			active: true,
			generation: 6,
			actualConfig: processorConfig(),
		});
		await oldTransition;
		newExecutor.dispose();

		expect(newState).toMatchObject({
			actualMode: 'capture',
			phase: 'active',
			generation: 9,
		});
		expect(newBadge).toHaveBeenCalledTimes(1);
		expect(oldState).toMatchObject({ actualMode: 'bypass', phase: 'starting', generation: 5 });
	});
});
