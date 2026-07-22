import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AudioMode } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { createFullscreenAudioHandoff } from '../src/content/core/fullscreen-audio-handoff';
import type { PolicyExecutorState } from '../src/content/types';

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
			activeMode: AudioMode.CAPTURE,
			desiredMode: AudioMode.CAPTURE,
			actualMode: 'capture',
			phase: 'active',
			generation: 10,
			hasGesture: true,
			userHasInteracted: true,
			isPopupOpen: false,
		};
		const handoff = createFullscreenAudioHandoff({
			state,
			policyExecutor: { applyState } as never,
			audioController: { cleanup: mock(async () => undefined) } as never,
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
});
