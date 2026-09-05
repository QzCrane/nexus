import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { createFullscreenAudioHandoff } from '../src/content/core/fullscreen-audio-handoff';
import type { PolicyExecutorState } from '../src/content/types';
import {
	SPECTRA_FULLSCREEN_FINISH_EVENT,
	SPECTRA_FULLSCREEN_PREPARE_EVENT,
	SPECTRA_FULLSCREEN_RESULT_ATTRIBUTE,
	SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE,
} from '../src/shared/fullscreen-bridge';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('fullscreen audio handoff', () => {
	test('resumes the same acknowledged Capture through its one-shot continuation', async () => {
		const rootAttributes = new Map<string, string>();
		const documentTarget = new EventTarget();
		Object.defineProperty(documentTarget, 'documentElement', {
			value: {
				setAttribute: (name: string, value: string) => { rootAttributes.set(name, value); },
				removeAttribute: (name: string) => { rootAttributes.delete(name); },
				getAttribute: (name: string) => rootAttributes.get(name) ?? null,
			},
		});
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentTarget });

		const resume = mock(async () => ({
			status: 'processing' as const,
			phase: 'active' as const,
			active: true,
			generation: 12,
			actualConfig: DEFAULT_AUDIO_CONFIG,
		}));
		const suspendForContinuation = mock(async () => ({ resume }));
		const applyState = mock(async () => undefined);
		const state: PolicyExecutorState = {
			config: { ...DEFAULT_AUDIO_CONFIG, boost: 2, volume: 200 },
			appliedConfig: { ...DEFAULT_AUDIO_CONFIG, boost: 2, volume: 200 },
			activeMode: 'capture',
			desiredMode: 'capture',
			actualMode: 'capture',
			phase: 'active',
			generation: 10,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		const handoff = createFullscreenAudioHandoff({
			state,
			policyExecutor: { applyState } as never,
			captureManager: {
				isActive: () => true,
				waitForSettled: async () => undefined,
				suspendForContinuation,
				getGeneration: () => 11,
				getActualConfig: () => DEFAULT_AUDIO_CONFIG,
			} as never,
		});

		const order: string[] = [];
		await handoff.run(async () => { order.push('fullscreen'); });
		expect(suspendForContinuation).toHaveBeenCalledTimes(1);
		expect(resume).toHaveBeenCalledTimes(1);
		expect(applyState).toHaveBeenCalledWith({ modeIntent: true });
		expect(order).toEqual(['fullscreen']);
		expect(state.actualMode).toBe('capture');
		expect(state.phase).toBe('active');
		handoff.dispose();
	});

	test('rejects malformed and non-current finish events at the page boundary', async () => {
		const rootAttributes = new Map<string, string>();
		const documentTarget = new EventTarget();
		Object.defineProperty(documentTarget, 'documentElement', {
			value: {
				setAttribute: (name: string, value: string) => { rootAttributes.set(name, value); },
				removeAttribute: (name: string) => { rootAttributes.delete(name); },
				getAttribute: (name: string) => rootAttributes.get(name) ?? null,
			},
		});
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentTarget });
		const handoff = createFullscreenAudioHandoff({
			state: {
				config: DEFAULT_AUDIO_CONFIG,
				appliedConfig: DEFAULT_AUDIO_CONFIG,
				activeMode: 'bypass',
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 0,
				userHasInteracted: false,
				isPopupOpen: false,
			},
			policyExecutor: { applyState: async () => undefined } as never,
			captureManager: {
				isActive: () => false,
				waitForSettled: async () => undefined,
			} as never,
		});

		const invalidIds = ['', 'arbitrary', '00000000-0000-0000-0000-000000000000'];
		for (const requestId of invalidIds) {
			rootAttributes.set(SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE, JSON.stringify({ requestId }));
			documentTarget.dispatchEvent(new Event(SPECTRA_FULLSCREEN_FINISH_EVENT));
		}

		const first = crypto.randomUUID();
		rootAttributes.set(SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE, JSON.stringify({ requestId: first }));
		documentTarget.dispatchEvent(new Event(SPECTRA_FULLSCREEN_FINISH_EVENT));
		const other = crypto.randomUUID();
		rootAttributes.set(SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE, JSON.stringify({ requestId: other }));
		documentTarget.dispatchEvent(new Event(SPECTRA_FULLSCREEN_FINISH_EVENT));
		documentTarget.dispatchEvent(new Event(SPECTRA_FULLSCREEN_PREPARE_EVENT));
		await Promise.resolve();
		await Promise.resolve();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		// The second id becomes the current operation at PREPARE time and was not
		// allowed to inherit the first id's finish marker.
		expect(rootAttributes.get(SPECTRA_FULLSCREEN_RESULT_ATTRIBUTE)).toBe(
			JSON.stringify({ requestId: other }),
		);
		handoff.dispose();
	});
});
