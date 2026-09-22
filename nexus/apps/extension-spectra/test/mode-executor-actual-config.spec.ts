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
import { createPolicyExecutor } from '../src/content/logic/policy-executor';
import { createCaptureAdmission } from './helpers/capture-admission';

const ADMISSION = createCaptureAdmission();
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
let disposeCallbacks: (() => void) | null = null;
let currentExecutor: ModeExecutor | null = null;

afterEach(() => {
	disposeCallbacks?.();
	disposeCallbacks = null;
	currentExecutor = null;
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
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
		mediaRoute: 'auto',
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
	allMedia: HTMLMediaElement[] = media,
): PolicyExecutorDeps {
	const sources = (elements: HTMLMediaElement[]) => elements.map((element, index) => ({
		element,
		target: {
			frameId: 0,
			documentId: 'document-test',
			mediaId: `media:${index + 1}`,
			sourceRevision: 0,
			kind: 'audio' as const,
		},
	}));
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
			detachNode: mock(() => undefined),
			hasCompleteCoverage: () => false,
			hasKnownBindingFailure: () => false,
			applyConfig: mock(async () => { throw new Error('unconfigured WebAudio test'); }),
			...audioOverrides,
		} as unknown as PolicyExecutorDeps['audioController'],
		mediaRegistry: {
			list: () => sources(allMedia),
			listProcessingSources: () => sources(media),
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

function safeDataMedia(): HTMLMediaElement {
	return {
		currentSrc: 'data:audio/wav;base64,AA==',
		src: '',
		srcObject: null,
	} as HTMLMediaElement;
}

function installRouteRpc(initial: {
	mediaRoute: 'auto' | 'direct' | 'capture';
	source: 'auto' | 'user' | null;
}) {
	const records: Array<{ route: 'direct' | 'capture'; force?: boolean }> = [];
	let stored = { ...initial };
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				sendMessage: async (message: unknown) => {
					if (!message || typeof message !== 'object') {
						throw new Error('Expected a SPECTRA request envelope');
					}
					const envelope = message as {
						protocolVersion?: unknown;
						requestId?: unknown;
						type?: unknown;
						payload?: unknown;
					};
					expect(envelope.protocolVersion).toBe(2);
					expect(typeof envelope.requestId).toBe('string');
					if (envelope.type === 'spectra.audio.route.get') {
						return { ok: true, data: { ...stored } };
					}
					if (envelope.type === 'spectra.audio.route.record') {
						const payload = envelope.payload as { route: 'direct' | 'capture'; force?: boolean };
						records.push({ ...payload });
						stored = { mediaRoute: payload.route, source: 'auto' };
						return { ok: true, data: { ...stored } };
					}
					throw new Error(`Unexpected RPC ${String(envelope.type)}`);
				},
			},
		},
	});
	return {
		records,
		setStored(next: typeof stored) { stored = { ...next }; },
	};
}

describe('three-owner audio mode executor', () => {
	test('refreshes a same-document route in the policy queue and retires a neutral Capture owner', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'capture', source: 'user' });
		const runtimeState = state('capture');
		runtimeState.config = clone(DEFAULT_AUDIO_CONFIG);
		runtimeState.appliedConfig = clone(DEFAULT_AUDIO_CONFIG);
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		const request = mock(async () => ({
			status: 'idle' as const,
			phase: 'idle' as const,
			active: false,
			generation: 6,
		}));
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig: mock(async () => clone(DEFAULT_AUDIO_CONFIG)),
			request,
		});
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');
		routeRpc.setStored({ mediaRoute: 'direct', source: 'user' });

		await executor.applyNavigation(() => true);

		expect(runtimeState.mediaRoute).toBe('direct');
		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 6);
		expect(runtimeState).toMatchObject({
			actualMode: 'bypass',
			phase: 'idle',
			generation: 6,
		});
		executor.dispose();
	});

	test('invalidates an older route stop without inventing Capture authority for the newer route', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'capture', source: 'user' });
		const runtimeState = state('capture');
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		let captureActive = true;
		const stopEntered = deferred<void>();
		const stopBarrier = deferred<void>();
		const request = mock(async (enabled: boolean) => {
			if (enabled) throw new Error('Navigation must not invent Capture admission');
			stopEntered.resolve(undefined);
			await stopBarrier.promise;
			captureActive = false;
			return {
				status: 'idle' as const,
				phase: 'idle' as const,
				active: false,
				generation: 6,
			};
		});
		const runtimeDeps = deps({
			isActive: () => captureActive,
			syncConfig: mock(async () => clone(DEFAULT_AUDIO_CONFIG)),
			request,
		});
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');
		routeRpc.setStored({ mediaRoute: 'direct', source: 'user' });

		const oldRoute = executor.applyNavigation(() => true);
		await stopEntered.promise;
		routeRpc.setStored({ mediaRoute: 'capture', source: 'user' });
		const newRoute = executor.applyNavigation(() => true);
		stopBarrier.resolve(undefined);
		await Promise.all([oldRoute, newRoute]);

		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 6);
		expect(runtimeState).toMatchObject({
			mediaRoute: 'capture',
			actualMode: 'bypass',
			phase: 'error',
			lastError: 'Capture requires a current-tab extension invocation',
		});
		executor.dispose();
	});

	test('does not orphan an active Capture sync when a projection keeps the same capture route', async () => {
		installRouteRpc({ mediaRoute: 'capture', source: 'user' });
		const runtimeState = state('capture');
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		const syncEntered = deferred<void>();
		const syncBarrier = deferred<AudioConfig>();
		const actual = processorConfig();
		const syncConfig = mock(async () => {
			syncEntered.resolve(undefined);
			return syncBarrier.promise;
		});
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig,
		});
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		const applying = executor.applyState();
		await syncEntered.promise;
		const projected = executor.applyMediaRouteChange();
		syncBarrier.resolve(actual);
		await Promise.all([applying, projected]);

		expect(syncConfig).toHaveBeenCalledTimes(1);
		expect(runtimeState).toMatchObject({
			mediaRoute: 'capture',
			actualMode: 'capture',
			phase: 'active',
		});
		expect(runtimeState.appliedConfig).toEqual(actual);
		executor.dispose();
	});

	test('lets a SAFE automatic route fall through a failed page bind to admitted Capture', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'direct', source: 'auto' });
		const runtimeState = state('webaudio');
		const actual = processorConfig();
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: actual,
		}));
		const media = safeDataMedia();
		const runtimeDeps = deps({ request, getActualConfig: () => actual }, {
			canAttachAll: () => true,
			initialize: async () => true,
			ensureAttached: () => false,
			hasCompleteCoverage: () => false,
		}, [media]);
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		await executor.applyState({ captureAdmission: ADMISSION });

		expect(request).toHaveBeenCalledWith(true, runtimeState.config, 5, { admission: ADMISSION });
		expect(runtimeState).toMatchObject({
			mediaRoute: 'auto',
			actualMode: 'capture',
			phase: 'active',
			generation: 6,
		});
		expect(runtimeState.appliedConfig).toEqual(actual);
		expect(routeRpc.records).toContainEqual({ route: 'capture', force: true });
		executor.dispose();
	});

	test('neutralizes an active user-direct graph before rejecting a newly unsafe selected source', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'direct', source: 'user' });
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		runtimeState.actualMode = 'webaudio';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = clone(runtimeState.config);
		const safe = safeDataMedia();
		const media = [safe];
		const bypassBarrier = deferred<void>();
		const bypassEntered = deferred<void>();
		const bypass = mock(async () => {
			bypassEntered.resolve(undefined);
			await bypassBarrier.promise;
		});
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const runtimeDeps = deps({ request }, {
			isReady: () => true,
			bypass,
			canAttachAll: (elements: HTMLMediaElement[]) => elements.every((element) => element === safe),
		}, media);
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		media.push({
			currentSrc: safe.currentSrc,
			src: safe.src,
			srcObject: {} as MediaProvider,
		} as HTMLMediaElement);
		let settled = false;
		const applying = executor.applyState({ captureAdmission: ADMISSION })
			.finally(() => { settled = true; });
		await bypassEntered.promise;

		expect(bypass).toHaveBeenCalledTimes(1);
		expect(settled).toBe(false);
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'webaudio', phase: 'active' });

		bypassBarrier.resolve(undefined);
		await applying;

		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({
			mediaRoute: 'direct',
			actualMode: 'bypass',
			phase: 'error',
		});
		expect(runtimeState.lastError).toContain('Direct route cannot bind');
		expect(routeRpc.records).not.toContainEqual(expect.objectContaining({ route: 'capture' }));
		executor.dispose();
	});

	test('retains actual WebAudio ownership when neutralizing an unsafe selected source fails', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'direct', source: 'user' });
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		runtimeState.actualMode = 'webaudio';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = clone(runtimeState.config);
		const safe = safeDataMedia();
		const media = [safe];
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const bypass = mock(async () => { throw new Error('graph bypass rejected'); });
		const runtimeDeps = deps({ request }, {
			isReady: () => true,
			bypass,
			canAttachAll: (elements: HTMLMediaElement[]) => elements.every((element) => element === safe),
		}, media);
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		media.push({
			currentSrc: safe.currentSrc,
			src: safe.src,
			srcObject: {} as MediaProvider,
		} as HTMLMediaElement);
		await executor.applyState({ captureAdmission: ADMISSION });

		expect(bypass).toHaveBeenCalledTimes(1);
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({
			mediaRoute: 'direct',
			actualMode: 'webaudio',
			phase: 'error',
			lastError: 'Unable to neutralize Media WebAudio: graph bypass rejected',
		});
		expect(runtimeState.appliedConfig).toEqual(runtimeState.config);
		expect(routeRpc.records).not.toContainEqual(expect.objectContaining({ route: 'capture' }));
		executor.dispose();
	});

	test('does not turn an automatic Capture fallback into success without a grant', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'direct', source: 'auto' });
		const runtimeState = state('webaudio');
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const runtimeDeps = deps({ request }, {
			canAttachAll: () => true,
			initialize: async () => true,
			ensureAttached: () => false,
			hasCompleteCoverage: () => false,
		}, [safeDataMedia()]);
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		await executor.applyState();

		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({
			mediaRoute: 'auto',
			actualMode: 'bypass',
			phase: 'error',
		});
		expect(runtimeState.lastError).toContain('did not bind the complete registry scope');
		expect(routeRpc.records).not.toContainEqual(expect.objectContaining({ route: 'capture' }));
		executor.dispose();
	});

	test('neutralizes an active page graph before an unsafe selected source can fall back to Capture', async () => {
		const routeRpc = installRouteRpc({ mediaRoute: 'direct', source: 'auto' });
		const runtimeState = state('webaudio');
		runtimeState.actualMode = 'webaudio';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = clone(runtimeState.config);
		const safe = safeDataMedia();
		const media = [safe];
		const bypassBarrier = deferred<void>();
		const bypassEntered = deferred<void>();
		let bypassCalls = 0;
		const bypass = mock(async () => {
			bypassCalls += 1;
			if (bypassCalls === 1) {
				bypassEntered.resolve(undefined);
				await bypassBarrier.promise;
			}
		});
		const actual = processorConfig();
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: actual,
		}));
		const runtimeDeps = deps({ request, getActualConfig: () => actual }, {
			isReady: () => true,
			bypass,
			canAttachAll: (elements: HTMLMediaElement[]) => elements.every((element) => element === safe),
		}, media);
		const executor = await createPolicyExecutor(runtimeDeps, runtimeState);
		if (!executor) throw new Error('Expected current policy executor');

		// A MediaStream-backed source is unsafe even when its stale URL still looks
		// origin-owned. It joins the selected processing universe before policy runs.
		media.push({
			currentSrc: safe.currentSrc,
			src: safe.src,
			srcObject: {} as MediaProvider,
		} as HTMLMediaElement);
		let firstSettled = false;
		const first = executor.applyState().finally(() => { firstSettled = true; });
		await bypassEntered.promise;

		expect(bypass).toHaveBeenCalledTimes(1);
		expect(firstSettled).toBe(false);
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'webaudio', phase: 'active' });

		bypassBarrier.resolve(undefined);
		await first;
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({
			mediaRoute: 'auto',
			actualMode: 'bypass',
			phase: 'error',
		});
		expect(runtimeState.lastError).toBe('Capture requires a current-tab extension invocation');

		await executor.applyState({ captureAdmission: ADMISSION });
		expect(bypass).toHaveBeenCalledTimes(2);
		expect(request).toHaveBeenCalledWith(true, runtimeState.config, 6, { admission: ADMISSION });
		expect(runtimeState).toMatchObject({
			actualMode: 'capture',
			phase: 'active',
			generation: 6,
		});
		expect(runtimeState.appliedConfig).toEqual(actual);
		expect(routeRpc.records).toContainEqual({ route: 'capture', force: undefined });
		executor.dispose();
	});

	test('retires an existing Capture before reporting a user-direct coverage failure', async () => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		runtimeState.appliedConfig = clone(runtimeState.config);
		const transparent = clone(DEFAULT_AUDIO_CONFIG);
		const syncConfig = mock(async () => transparent);
		const bypass = mock(async () => undefined);
		const request = mock(async (enabled: boolean) => ({
			status: enabled ? 'processing' as const : 'idle' as const,
			phase: enabled ? 'active' as const : 'idle' as const,
			active: enabled,
			generation: 6,
		}));
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig,
			request,
		}, { isReady: () => true, bypass, canAttachAll: () => false });
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(syncConfig).toHaveBeenCalledWith(DEFAULT_AUDIO_CONFIG, 5);
		expect(bypass).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 5);
		expect(runtimeState).toMatchObject({
			mediaRoute: 'direct',
			actualMode: 'bypass',
			phase: 'error',
			generation: 6,
		});
		expect(runtimeState.lastError).toContain('Direct route cannot bind');
	});

	test('retains existing Capture ownership when a user-direct retirement is rejected', async () => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		const transparent = clone(DEFAULT_AUDIO_CONFIG);
		const bypass = mock(async () => undefined);
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			error: 'processor refused to stop',
		}));
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig: mock(async () => transparent),
			request,
		}, { isReady: () => true, bypass, canAttachAll: () => false });
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 5);
		expect(bypass).toHaveBeenCalledTimes(1);
		expect(runtimeState).toMatchObject({
			mediaRoute: 'direct',
			actualMode: 'capture',
			phase: 'error',
			generation: 6,
			lastError: 'processor refused to stop',
		});
		expect(runtimeState.appliedConfig).toEqual(transparent);
	});

	test('rechecks selected sources after WebAudio initialization before attaching the graph', async () => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		const safe = safeDataMedia();
		const media = [safe];
		const initializeBarrier = deferred<boolean>();
		const applyConfig = mock(async () => { throw new Error('partial graph must not be applied'); });
		const runtimeDeps = deps({}, {
			canAttachAll: (elements: HTMLMediaElement[]) => elements.every((element) => element === safe),
			initialize: mock(async () => initializeBarrier.promise),
			ensureAttached: () => true,
			hasCompleteCoverage: () => true,
			applyConfig,
		}, media);
		bindCallbacks(runtimeDeps, runtimeState);

		const applying = executeMode(runtimeDeps, runtimeState, false, ADMISSION);
		await Promise.resolve();
		media.push({ ...safe, srcObject: {} as MediaProvider } as HTMLMediaElement);
		initializeBarrier.resolve(true);
		await applying;

		expect(applyConfig).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'bypass', phase: 'error' });
		expect(runtimeState.lastError).toContain('coverage changed during WebAudio initialization');
	});

	test('rejects a WebAudio ACK when the selected source set changes during graph application', async () => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = 'direct';
		const first = safeDataMedia();
		const media = [first];
		const graphConfig = audioConfigToProcessorConfig(runtimeState.config);
		const applyBarrier = deferred<void>();
		const applyConfig = mock(async () => {
			await applyBarrier.promise;
			return {
				phase: 'active' as const,
				contextState: 'running' as const,
				graphSignature: audioGraphSignature(graphConfig),
				normalizedActualConfig: graphConfig,
				outputChannels: 2,
				sourceCount: 1,
			};
		});
		const runtimeDeps = deps({}, {
			canAttachAll: () => true,
			initialize: mock(async () => true),
			ensureAttached: () => true,
			hasCompleteCoverage: (elements: HTMLMediaElement[]) => elements.length === 1,
			applyConfig,
		}, media);
		bindCallbacks(runtimeDeps, runtimeState);

		const applying = executeMode(runtimeDeps, runtimeState, false, ADMISSION);
		await Promise.resolve();
		await Promise.resolve();
		media.push(safeDataMedia());
		applyBarrier.resolve(undefined);
		await applying;

		expect(applyConfig).toHaveBeenCalledTimes(1);
		expect(runtimeState).toMatchObject({ actualMode: 'bypass', phase: 'error' });
		expect(runtimeState.lastError).toContain('coverage changed before WebAudio acknowledgement');
	});

	test('detaches excluded registry elements before dispatching Capture', async () => {
		const runtimeState = state('capture');
		const excluded = {} as HTMLMediaElement;
		const detachNode = mock(() => undefined);
		const request = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 6,
			actualConfig: runtimeState.config,
		}));
		const runtimeDeps = deps({ request }, { detachNode }, [], [excluded]);
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(detachNode).toHaveBeenCalledTimes(1);
		expect(detachNode).toHaveBeenCalledWith(excluded);
		expect(runtimeState).toMatchObject({ actualMode: 'capture', phase: 'active' });
	});

	test('detaches excluded registry elements before dispatching native bypass', async () => {
		const runtimeState = state('bypass');
		const excluded = {} as HTMLMediaElement;
		const detachNode = mock(() => undefined);
		const request = mock(async () => { throw new Error('Capture must not run'); });
		const runtimeDeps = deps({ request }, { detachNode }, [], [excluded]);
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState);

		expect(detachNode).toHaveBeenCalledTimes(1);
		expect(detachNode).toHaveBeenCalledWith(excluded);
		expect(request).not.toHaveBeenCalled();
		expect(runtimeState).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
	});

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

	test.each(['auto', 'direct'] as const)('releases Capture if a neutral %s analyser fails to initialize', async (route) => {
		const runtimeState = state('webaudio');
		runtimeState.mediaRoute = route;
		runtimeState.config = clone(DEFAULT_AUDIO_CONFIG);
		runtimeState.actualMode = 'capture';
		runtimeState.phase = 'active';
		runtimeState.visualizerSubscribers.add('popup-visualizer');
		const request = mock(async (enabled: boolean) => ({
			status: enabled ? 'processing' as const : 'idle' as const,
			phase: enabled ? 'active' as const : 'idle' as const,
			active: enabled,
			generation: 6,
		}));
		const runtimeDeps = deps({
			isActive: () => true,
			syncConfig: mock(async () => clone(DEFAULT_AUDIO_CONFIG)),
			request,
		}, { canAttachAll: () => true, initialize: mock(async () => false) }, [safeDataMedia()]);
		bindCallbacks(runtimeDeps, runtimeState);

		await executeMode(runtimeDeps, runtimeState, false, ADMISSION);

		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(false, runtimeState.config, 5);
		expect(runtimeState).toMatchObject({ actualMode: 'bypass', desiredMode: 'bypass', phase: 'idle' });
		expect(runtimeState.visualizerSubscribers.size).toBe(1);
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
