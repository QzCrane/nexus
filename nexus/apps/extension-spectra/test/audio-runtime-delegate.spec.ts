import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, type ControlIntent } from '@nexus/contracts';
import { createAudioRuntimeControlDelegate } from '../src/content/logic/audio-runtime-control-delegate';
import type { PolicyExecutor } from '../src/content/logic/policy-executor';
import type { PolicyExecutorState } from '../src/content/types';
import { mergeControlFields } from '../src/popup/card/types';
import { createCaptureAdmission } from './helpers/capture-admission';

describe('audio runtime coverage boundary', () => {
	test('forwards one intent-scoped Capture admission into policy application', async () => {
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
		};

		await delegate.apply(intent, intent.patch);

		expect(updateConfig.mock.calls[0]?.[1]).toEqual({
			captureAdmission,
		});
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
			expect(updateConfig.mock.calls[0]?.[1]).toEqual({});
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
	expect(delegate.readAudioVolume?.(25, false)).toEqual({ effectiveVolume: 50, volumeState: 'capture' });
	expect(delegate.readAudioVolume?.(25, true)).toEqual({ effectiveVolume: 50, volumeState: 'silent' });
	expect(updateConfig).not.toHaveBeenCalled();
	expect(state.appliedConfig).toBe(applied);
	expect(state.generation).toBe(2);
});
