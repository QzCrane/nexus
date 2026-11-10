import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, splitEffectiveVolume, type AudioConfig, type ControlIntent } from '@nexus/contracts';
import { createAudioRuntimeControlDelegate } from '../src/content/logic/audio-runtime-control-delegate';
import { CAPTURE_ADMISSION_REQUIRED, toDomAppliedConfig } from '../src/content/logic/mode-executor';
import type { PolicyExecutor } from '../src/content/logic/policy-executor';
import type { PolicyExecutorState } from '../src/content/types';
import { mergeControlFields } from '../src/popup/card/types';
import { createCaptureAdmission } from './helpers/capture-admission';

describe('audio runtime coverage boundary', () => {
	test('forwards Capture admission but gives the retired hold field no policy authority', async () => {
		const captureAdmission = createCaptureAdmission({
			document: { tabId: 7, frameId: 0, documentId: 'document:dsp' },
			documentEpoch: 2,
		});
		const state: PolicyExecutorState = {
			config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			activeMode: 'bypass',
			desiredMode: 'bypass',
			actualMode: 'bypass',
			phase: 'idle',
			generation: 2,
			userHasInteracted: false,
			isPopupOpen: false,
		};
		const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent: ControlIntent = {
			intentId: 'intent:admitted-popup',
			tabId: 7,
			documentId: 'document:dsp',
			generation: 2,
			baseRevision: 3,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			actualContext: {},
			patch: { boost: 2 },
			captureAdmission,
			processorHold: true,
		};

		await delegate.apply(intent, intent.patch);

		// An admitted Capture may own the amplified scale, so the requested Boost
		// must reach the policy untouched.
		expect(updateConfig.mock.calls[0]?.[0]).toMatchObject({ boost: 2 });
		expect(updateConfig.mock.calls[0]?.[1]).toEqual({
			captureAdmission,
			deferPersistence: true,
		});
	});

	test('preserves a refused hotkey request and reports the actual native ceiling as failure', async () => {
		const state: PolicyExecutorState = {
			config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			activeMode: 'bypass',
			desiredMode: 'capture',
			actualMode: 'bypass',
			phase: 'error',
			generation: 2,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		// The policy never leaves bypass: no Capture admission arrived and no page
		// graph can take the media, so the document stays at its native ceiling.
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.appliedConfig = toDomAppliedConfig(state.config);
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent: ControlIntent = {
			intentId: 'intent:page-hotkey-over-ceiling',
			tabId: 7,
			documentId: 'document:dsp',
			generation: 2,
			baseRevision: 3,
			source: 'hotkey',
			requestedCoverage: 'full',
			target: null,
			actualContext: {},
			patch: { boost: 1.1 },
		};

		const fields = await delegate.apply(intent, intent.patch);

		expect(updateConfig.mock.calls[0]?.[0]).toMatchObject({
			boost: 1.1,
			volumeBase: 100,
			volume: 110,
		});
		expect(fields.boost).toMatchObject({
			desired: 1.1,
			actual: 1,
			phase: 'error',
			strategy: 'unsupported',
			controlled: false,
		});
	});

	test('keeps a hotkey boost when the document can carry it without Capture', async () => {
		for (const canAmplify of ['page-graph', 'live-processor', 'page-native-scale'] as const) {
			const base = {
				...DEFAULT_AUDIO_CONFIG,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			};
			const state: PolicyExecutorState = {
				config: { ...base },
				appliedConfig: { ...base },
				activeMode: 'bypass',
				desiredMode: 'webaudio',
				actualMode: canAmplify === 'live-processor' ? 'webaudio' : 'bypass',
				phase: canAmplify === 'live-processor' ? 'active' : 'idle',
				generation: 2,
				userHasInteracted: true,
				isPopupOpen: false,
				...(canAmplify === 'page-graph' ? { mediaWebAudio: true } : {}),
				...(canAmplify === 'page-native-scale'
					? { appliedConfig: { ...base, volumeBase: 110, volume: 110 } }
					: {}),
			};
			const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
				state.config = { ...state.config, ...changes };
				state.appliedConfig = { ...state.appliedConfig, ...changes };
				return { ok: true as const, data: { revision: 1 } };
			});
			const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
			const intent: ControlIntent = {
				intentId: `intent:${canAmplify}`,
				tabId: 7,
				documentId: 'document:dsp',
				generation: 2,
				baseRevision: 3,
				source: 'hotkey',
				requestedCoverage: 'full',
				target: null,
				actualContext: {},
				patch: { boost: 1.1 },
			};

			await delegate.apply(intent, intent.patch);

			expect(updateConfig.mock.calls[0]?.[0]).toMatchObject({ boost: 1.1 });
		}
	});

	test('leaves every shortcut OSD side effect to the aggregate ACK feedback owner', async () => {
		for (const source of ['restore', 'remote', 'hotkey'] as const) {
			const state: PolicyExecutorState = {
				config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				activeMode: 'bypass',
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 2,
				userHasInteracted: true,
				isPopupOpen: false,
			};
			const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
			const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
			const intent: ControlIntent = {
				intentId: `intent:${source}`,
				tabId: 7,
				documentId: 'document:dsp',
				generation: 2,
				baseRevision: 3,
				source,
				requestedCoverage: 'full',
				target: null,
				actualContext: {},
				patch: { boost: 2 },
			};
			await delegate.apply(intent, intent.patch);
		expect(updateConfig.mock.calls[0]?.[1]).toEqual({
			deferPersistence: true,
		});
		}
	});

	test('rejects target-only DSP before mutating config or starting Capture', async () => {
		const updateConfig = mock(async () => {
			throw new Error('target-only DSP must not reach policy execution');
		});
		const state: PolicyExecutorState = {
			config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			activeMode: 'bypass',
			desiredMode: 'bypass',
			actualMode: 'bypass',
			phase: 'idle',
			generation: 2,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		const delegate = createAudioRuntimeControlDelegate({
			updateConfig,
		} as unknown as PolicyExecutor, state);
		const intent: ControlIntent = {
			intentId: 'intent:target-dsp',
			tabId: 7,
			documentId: 'document:dsp',
			generation: 2,
			baseRevision: 3,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: null,
			actualContext: {},
			patch: { boost: 2 },
		};
		const fields = await delegate.apply(intent, intent.patch);
		expect(updateConfig).not.toHaveBeenCalled();
		expect(fields.boost).toMatchObject({
			phase: 'error',
			strategy: 'unsupported',
			coverage: 'partial',
			lastError: { code: 'coverage-incomplete', retryable: true },
		});
	});

	test('expands the session gate so disable reports every processor field as released without erasing settings', async () => {
		const configured = {
			...DEFAULT_AUDIO_CONFIG,
			enabled: true,
			boost: 2,
			volume: 200,
			eqValues: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		};
		const state: PolicyExecutorState = {
			config: { ...configured, eqValues: [...configured.eqValues] },
			appliedConfig: { ...configured, eqValues: [...configured.eqValues] },
			activeMode: 'capture',
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'active',
			generation: 2,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		const updateConfig = mock(async (changes: { enabled?: boolean }) => {
			state.config = { ...state.config, ...changes };
			state.actualMode = 'bypass';
			state.phase = 'idle';
			state.appliedConfig = {
				...DEFAULT_AUDIO_CONFIG,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			};
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({
			updateConfig,
		} as unknown as PolicyExecutor, state);
		const intent: ControlIntent = {
			intentId: 'intent:disable-runtime',
			tabId: 7,
			documentId: 'document:dsp',
			generation: 2,
			baseRevision: 3,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			actualContext: {},
			patch: { audioEnabled: false },
		};
		const fields = await delegate.apply(intent, intent.patch);
		expect(fields.audioEnabled).toMatchObject({ phase: 'applied', actual: false });
		expect(fields.boost).toMatchObject({
			desired: 2,
			actual: 1,
			phase: 'idle',
			strategy: 'observe',
			controlled: false,
		});
		expect(fields.eqValues).toMatchObject({ phase: 'idle', controlled: false });
		const projected = mergeControlFields(configured, fields);
		expect(projected.enabled).toBe(false);
		expect(projected.boost).toBe(2);
		expect(projected.eqValues[0]).toBe(3);
	});

	test('does not acknowledge audioEnabled active when a requested processor failed to start', async () => {
		const state: PolicyExecutorState = {
			config: {
				...DEFAULT_AUDIO_CONFIG,
				enabled: false,
				boost: 2,
				volume: 200,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			},
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			activeMode: 'bypass',
			desiredMode: 'capture',
			actualMode: 'bypass',
			phase: 'error',
			generation: 2,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		const updateConfig = mock(async (changes: { enabled?: boolean }) => {
			state.config = { ...state.config, ...changes };
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent: ControlIntent = {
			intentId: 'intent:enable-runtime',
			tabId: 7,
			documentId: 'document:dsp',
			generation: 2,
			baseRevision: 3,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			actualContext: {},
			patch: { audioEnabled: true },
		};
		const fields = await delegate.apply(intent, intent.patch);
		expect(fields.audioEnabled).toMatchObject({
			desired: true,
			actual: false,
			phase: 'error',
			strategy: 'extension-state',
		});
		expect(fields.boost).toMatchObject({
			desired: 2,
			actual: 1,
			phase: 'error',
			strategy: 'unsupported',
		});
	});
});


test('volume feedback reads the actual processor without applying desired state or acquiring resources', () => {
	const applied = { ...DEFAULT_AUDIO_CONFIG, volumeBase: 50, boost: 2, volume: 100, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
	const state: PolicyExecutorState = {
		config: { ...applied, boost: 3, volume: 150 }, appliedConfig: applied,
		activeMode: 'capture', desiredMode: 'capture', actualMode: 'capture', phase: 'active',
		generation: 2, userHasInteracted: true, isPopupOpen: false,
	};
	const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
	const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
	expect(delegate.readAudioVolume?.(25, false)).toEqual({ effectiveVolume: 50, volumeState: 'native' });
	expect(delegate.readAudioVolume?.(25, true)).toEqual({ effectiveVolume: 50, volumeState: 'silent' });
	expect(updateConfig).not.toHaveBeenCalled();
	expect(state.appliedConfig).toBe(applied);
	expect(state.generation).toBe(2);
});

test('reports a missing Capture admission as an unavailable capability, not a readback', async () => {
	const applied = { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
	const state: PolicyExecutorState = {
		config: { ...applied, boost: 1.5 },
		appliedConfig: applied,
		activeMode: 'bypass', desiredMode: 'capture', actualMode: 'bypass', phase: 'error',
		// The policy runtime's own verdict: this document cannot start Capture.
		lastError: CAPTURE_ADMISSION_REQUIRED,
		generation: 2, userHasInteracted: true, isPopupOpen: false,
	};
	const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
	const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
	const intent: ControlIntent = {
		intentId: 'intent:background-boost',
		tabId: 7,
		documentId: 'document:dsp',
		generation: 2,
		baseRevision: 3,
		source: 'popup',
		requestedCoverage: 'full',
		target: null,
		actualContext: {},
		patch: { boost: 1.5 },
	};
	const fields = await delegate.apply(intent, intent.patch);
	expect(fields.boost).toMatchObject({
		phase: 'error',
		lastError: { code: 'capability-unavailable', retryable: false, message: CAPTURE_ADMISSION_REQUIRED },
	});
});

describe('document output control', () => {
	test.each([
		['auto', undefined, true, null],
		['auto', true, true, 'media-webaudio'],
		['auto', false, true, 'capture'],
		['capture', undefined, true, 'capture'],
		['direct', undefined, true, 'media-webaudio'],
		['capture', false, false, null],
	] as const)('publishes a side-effect-free prospective route (%s, coverage %s, enabled %s)', (mediaRoute, mediaWebAudio, enabled, expected) => {
		const state = outputState();
		state.mediaRoute = mediaRoute;
		state.mediaWebAudio = mediaWebAudio;
		state.config.enabled = enabled;
		const before = structuredClone(state);
		const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		expect(delegate.read(['volumeBase']).prospectiveBoostRoute).toBe(expected);
		expect(state).toEqual(before);
		expect(updateConfig).not.toHaveBeenCalled();
	});

	function outputState(): PolicyExecutorState {
		return {
			config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			activeMode: 'bypass', desiredMode: 'bypass', actualMode: 'bypass', phase: 'idle',
			generation: 2, userHasInteracted: true, isPopupOpen: false,
		};
	}

	function outputIntent(patch: ControlIntent['patch']): ControlIntent {
		return {
			intentId: 'intent:document-output', tabId: 7, documentId: 'document:output',
			generation: 2, baseRevision: 3, source: 'popup', requestedCoverage: 'full',
			target: null, actualContext: {}, patch,
		};
	}

	test('keeps the full attenuation and amplification scale on acknowledged Capture output', async () => {
		const state = outputState();
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.appliedConfig = { ...state.config, eqValues: [...state.config.eqValues] };
			state.actualMode = 'capture';
			state.phase = 'active';
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		for (const volume of [0, 30, 70, 100, 200]) {
			const patch = { ...splitEffectiveVolume(volume), mediaMuted: false };
			const fields = await delegate.apply(outputIntent(patch), patch, true);
			expect(updateConfig.mock.calls.at(-1)?.[0]).toMatchObject({
				documentOutput: true, volume, volumeBase: patch.volumeBase, boost: patch.boost, muted: false,
			});
			expect(fields.volumeBase).toMatchObject({ phase: 'applied', actual: patch.volumeBase, strategy: 'capture', coverage: 'opaque', controlled: true });
			expect(fields.boost).toMatchObject({ phase: 'applied', actual: patch.boost, strategy: 'capture' });
			expect(fields.mediaMuted).toMatchObject({ phase: 'applied', actual: false, strategy: 'capture' });
			expect(delegate.read(['volumeBase', 'mediaMuted', 'boost'])).toEqual({
				prospectiveBoostRoute: null,
				patch: { volumeBase: patch.volumeBase, mediaMuted: false, boost: patch.boost },
				observedStrategies: { volumeBase: 'capture', mediaMuted: 'capture', boost: 'capture' },
			});
			expect(delegate.readAudioVolume?.(99, true)).toEqual({
				effectiveVolume: volume,
				volumeState: volume === 0 ? 'silent' : volume > 100 ? 'capture' : 'native',
			});
		}
	});

	test('mute and release preserve output volume while native observations cannot replace its owner', async () => {
		const state = outputState();
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.appliedConfig = { ...state.config, eqValues: [...state.config.eqValues] };
			state.actualMode = 'capture';
			state.phase = 'active';
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const level = { volumeBase: 70, boost: 1 };
		await delegate.apply(outputIntent(level), level, true);
		delegate.synchronizeNative({ volumeBase: 0, mediaMuted: true, speed: 1.5, preservePitch: false });
		expect(state.config).toMatchObject({ documentOutput: true, volumeBase: 70, volume: 70, muted: false, speed: 1.5, preservePitch: false });
		expect(state.appliedConfig).toMatchObject({ documentOutput: true, volumeBase: 70, volume: 70, muted: false, speed: 1.5, preservePitch: false });
		for (const muted of [true, false]) {
			const patch = { mediaMuted: muted };
			const fields = await delegate.apply(outputIntent(patch), patch);
			expect(fields.mediaMuted).toMatchObject({ phase: 'applied', strategy: 'capture', actual: muted });
			expect(state.appliedConfig).toMatchObject({ volume: 70, volumeBase: 70, boost: 1, muted });
			expect(delegate.readAudioVolume?.(0, !muted)).toEqual({ effectiveVolume: 70, volumeState: muted ? 'silent' : 'native' });
		}
	});

	test.each(['target-only', 'direct'] as const)('rejects %s output control before policy can acquire Capture', async (boundary) => {
		const state = outputState();
		if (boundary === 'direct') state.mediaRoute = 'direct';
		const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent = outputIntent({ volumeBase: 30, mediaMuted: false });
		if (boundary === 'target-only') intent.requestedCoverage = 'active-target';
		const fields = await delegate.apply(intent, intent.patch, true);
		expect(updateConfig).not.toHaveBeenCalled();
		expect(state.config.documentOutput).toBeUndefined();
		for (const field of ['volumeBase', 'mediaMuted'] as const) expect(fields[field]).toMatchObject({
			phase: 'error', strategy: 'unsupported', controlled: false,
			lastError: { code: boundary === 'direct' ? 'capability-unavailable' : 'coverage-incomplete' },
		});
	});

	test.each(['bypass', 'starting', 'unproven', 'wrong-volume'] as const)('never acknowledges default-matching output values without a matching physical owner (%s)', async (failure) => {
		const state = outputState();
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			if (failure !== 'bypass') state.actualMode = 'capture';
			state.phase = failure === 'starting' ? 'starting' : failure === 'bypass' ? 'error' : 'active';
			if (failure !== 'unproven') state.appliedConfig = { ...state.config };
			if (failure === 'wrong-volume') state.appliedConfig = { ...state.appliedConfig, volumeBase: 30, volume: 30 };
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent = outputIntent({ volumeBase: 100, boost: 1, mediaMuted: false });
		const fields = await delegate.apply(intent, intent.patch, true);
		for (const field of ['volumeBase', 'boost', 'mediaMuted'] as const) expect(fields[field]).toMatchObject({
			phase: 'error', controlled: false, lastError: { code: 'readback-mismatch' },
		});
	});

	test('leaves native base volume and mute outside the delegate until output ownership is requested', async () => {
		const state = outputState();
		const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
		delegate.synchronizeNative({ volumeBase: 30, mediaMuted: true });
		expect(state.appliedConfig).toMatchObject({ volumeBase: 30, volume: 30, muted: true });
		const intent = outputIntent({ volumeBase: 70, mediaMuted: false });
		expect(await delegate.apply(intent, intent.patch)).toEqual({});
		expect(updateConfig.mock.calls[0]?.[0]).toEqual({});
	});

	test('keeps a missing invocation as a capability failure even when the requested output is zero', async () => {
		const state = outputState();
		state.appliedConfig = { ...state.appliedConfig, volumeBase: 0, volume: 0 };
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.phase = 'error';
			state.lastError = CAPTURE_ADMISSION_REQUIRED;
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent = outputIntent({ volumeBase: 0, boost: 1, mediaMuted: false });
		const fields = await delegate.apply(intent, intent.patch, true);
		expect(fields.volumeBase).toMatchObject({
			desired: 0, actual: 0, phase: 'error', controlled: false,
			lastError: { code: 'capability-unavailable', retryable: false },
		});
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
	});

	test('allows an existing output owner to disable even after the route is pinned direct', async () => {
		const state = outputState();
		state.config = { ...state.config, documentOutput: true, volume: 30, volumeBase: 30 };
		state.appliedConfig = { ...state.config };
		state.actualMode = 'capture';
		state.phase = 'active';
		state.mediaRoute = 'direct';
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.appliedConfig = toDomAppliedConfig(state.config);
			state.actualMode = 'bypass';
			state.phase = 'idle';
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent = outputIntent({ audioEnabled: false });
		const fields = await delegate.apply(intent, intent.patch);
		expect(updateConfig).toHaveBeenCalledTimes(1);
		expect(fields.audioEnabled).toMatchObject({ phase: 'applied', actual: false });
		expect(fields.volumeBase).toMatchObject({ phase: 'idle', controlled: false, strategy: 'observe' });
		expect(fields.mediaMuted).toMatchObject({ phase: 'idle', controlled: false, strategy: 'observe' });
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
	});

	test('releases document-output ownership through the neutral physical bypass acknowledgement', async () => {
		const state = outputState();
		state.config = { ...state.config, documentOutput: true, volumeBase: 30, boost: 2, volume: 60, muted: true };
		state.appliedConfig = { ...state.config };
		state.actualMode = 'capture';
		state.phase = 'active';
		const updateConfig = mock(async (changes: Partial<AudioConfig>) => {
			state.config = { ...state.config, ...changes };
			state.appliedConfig = toDomAppliedConfig(state.config);
			state.actualMode = 'bypass';
			state.phase = 'idle';
			return { ok: true as const, data: { revision: 1 } };
		});
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		const intent: ControlIntent = { ...outputIntent({ volumeBase: 100, boost: 1, mediaMuted: false }), releaseDocumentOutput: true };
		const fields = await delegate.apply(intent, intent.patch, true);
		expect(updateConfig.mock.calls[0]?.[0]).toMatchObject({ documentOutput: undefined, volumeBase: 100, boost: 1, volume: 100, muted: false });
		expect(state.actualMode).toBe('bypass');
		expect(state.appliedConfig.documentOutput).toBeUndefined();
		for (const field of ['volumeBase', 'boost', 'mediaMuted'] as const) expect(fields[field]).toMatchObject({
			phase: 'applied', strategy: 'observe', controlled: false,
		});
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
	});

	test('reads the active physical output while a different desired value waits and stops exposing it after lifecycle retirement', () => {
		const state = outputState();
		state.appliedConfig = { ...state.appliedConfig, documentOutput: true, volumeBase: 30, boost: 2, volume: 60, muted: true };
		state.config = { ...state.appliedConfig, volumeBase: 70, boost: 3, volume: 210, muted: false };
		state.actualMode = 'capture';
		state.phase = 'active';
		const updateConfig = mock(async () => ({ ok: true as const, data: { revision: 1 } }));
		const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({
			prospectiveBoostRoute: null,
			patch: { volumeBase: 30, mediaMuted: true },
			observedStrategies: { volumeBase: 'capture', mediaMuted: 'capture' },
		});
		state.phase = 'error';
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
		state.actualMode = 'bypass';
		state.phase = 'idle';
		expect(delegate.read(['volumeBase', 'mediaMuted'])).toEqual({ patch: {}, observedStrategies: {}, prospectiveBoostRoute: null });
		expect(updateConfig).not.toHaveBeenCalled();
	});
});
