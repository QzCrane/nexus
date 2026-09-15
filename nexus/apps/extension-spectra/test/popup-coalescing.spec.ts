import { afterEach, describe, expect, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
} from '@nexus/contracts';
import { createUpdateFn } from '../src/popup/card/state';
import { resolveVolumePresentation } from '../src/popup/card/render';
import { COLORS } from '../src/popup/constants';
import type { CardInternalState } from '../src/popup/card/types';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalSetTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
const originalClearTimeout = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');

afterEach(() => {
	restoreProperty('chrome', originalChrome);
	restoreProperty('window', originalWindow);
	restoreProperty('performance', originalPerformance);
	restoreProperty('setTimeout', originalSetTimeout);
	restoreProperty('clearTimeout', originalClearTimeout);
});

describe('Popup latest-value config transport', () => {
	test('coalesces a 100-value slider burst into one IPC carrying the latest value', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 5, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		for (let index = 0; index < 100; index += 1) update({ volume: index + 1 });
		expect(harness.timers.size).toBe(1);
		expect(harness.requests).toHaveLength(0);
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		expect(requestVolume(harness.requests[0]?.message)).toBe(100);
		harness.resolveRequest(0, runtimeResponse(100, 1));
		await waitFor(() => state.controlGeneration === 1);
		expect(harness.requests).toHaveLength(1);
	});

	test('drops a repeated acknowledged value before scheduling any IPC', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 6, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 100 });
		update({ volume: 100 });
		expect(harness.timers.size).toBe(0);
		expect(harness.requests).toHaveLength(0);
		await update.flush();
		expect(harness.requests).toHaveLength(0);
	});

	test('keeps newer optimistic values when an older ACK arrives', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 7, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 10 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);

		update({ volume: 20 });
		update({ volume: 30 });
		harness.resolveRequest(0, runtimeResponse(10, 1));
		await waitFor(() => harness.timers.size === 1);
		expect(state.config.volumeBase).toBe(30);

		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(30);
		harness.resolveRequest(1, runtimeResponse(30, 2));
		await waitFor(() => state.controlGeneration === 2);
		expect(state.config.volumeBase).toBe(30);
	});

	test('drains a pending latest value after an in-flight request on pagehide', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 9, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 50 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		update({ volume: 75 });
		harness.window.dispatchEvent(new Event('pagehide'));

		harness.resolveRequest(0, runtimeResponse(50, 1));
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(75);
		expect(harness.timers.size).toBe(0);
		harness.resolveRequest(1, runtimeResponse(75, 2));
		await waitFor(() => harness.runtimeRequests.length === 1);
		expect(harness.runtimeRequests[0]?.type).toBe('spectra.audio.session.flush');
	});

	test('flushes the final slider value immediately on change', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 11, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 40 });
		expect(harness.timers.size).toBe(1);
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(harness.timers.size).toBe(0);
		expect(requestVolume(harness.requests[0]?.message)).toBe(40);
		harness.resolveRequest(0, runtimeResponse(40, 1));
		await drained;
		expect(state.config.volumeBase).toBe(40);
	});

	test('serializes a discrete media command behind the pending slider ACK', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 14, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 40 });
		let commandRevision: number | null = null;
		const command = update.runControl(async () => {
			commandRevision = state.controlRevision;
		});
		await waitFor(() => harness.requests.length === 1);
		expect(commandRevision).toBeNull();
		harness.resolveRequest(0, runtimeResponse(40, 3));
		await command;
		expect(commandRevision).toBe(3);
	});

	test('sends one above-100 effective-volume intent without rewriting mute', async () => {
		const harness = installHarness();
		const state = createState();
		state.config.muted = true;
		state.stableConfig.muted = true;
		const update = createUpdateFn(state, 12, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 200 });
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(requestVolume(harness.requests[0]?.message)).toBe(200);
		expect(requestType(harness.requests[0]?.message)).toBe('spectra.control.operation.submit');
		harness.resolveRequest(0, runtimeResponse(200, 1));
		await drained;

		expect(state.config.muted).toBe(true);
		expect(state.stableConfig.muted).toBe(true);
		expect(harness.requests).toHaveLength(1);
	});

	test('keeps one compound operation when the slider crosses the routing boundary', async () => {
		const harness = installHarness();
		const state = createState();
		state.config = { ...state.config, volume: 40, volumeBase: 40, boost: 1 };
		state.stableConfig = { ...state.config };
		const update = createUpdateFn(state, 13, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 250 });
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(requestVolume(harness.requests[0]?.message)).toBe(250);
		expect(requestType(harness.requests[0]?.message)).toBe('spectra.control.operation.submit');
		harness.resolveRequest(0, runtimeResponse(250, 1));
		await drained;

		expect(state.config.volume).toBe(250);
		expect(harness.requests).toHaveLength(1);
	});

	test('atomically switches the complete volume presentation across the processor boundary', async () => {
		const harness = installHarness();
		const state = createState();
		const frames: Array<{ volume: number; color: string }> = [];
		const render = () => {
			const presentation = resolveVolumePresentation(state);
			frames.push({
				volume: presentation.effectiveVolume,
				color: presentation.color,
			});
		};
		const update = createUpdateFn(state, 15, () => false, render, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 110 });
		expect(frames.at(-1)).toEqual({ volume: 100, color: COLORS.NATIVE });
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		harness.resolveRequest(0, runtimeResponse(110, 1, 'capture'));
		await drained;

		expect(frames.at(-1)).toEqual({ volume: 110, color: COLORS.CAPTURE });
		expect(frames).not.toContainEqual({ volume: 110, color: COLORS.NATIVE });

		update({ volume: 100 });
		expect(frames.at(-1)).toEqual({ volume: 110, color: COLORS.CAPTURE });
		const released = update.flush();
		await waitFor(() => harness.requests.length === 2);
		harness.resolveRequest(1, runtimeResponse(100, 2, 'observe'));
		await released;

		expect(frames.at(-1)).toEqual({ volume: 100, color: COLORS.NATIVE });
		expect(frames).not.toContainEqual({ volume: 100, color: COLORS.CAPTURE });
		expect(frames.every(({ color }) => (
			color === COLORS.NATIVE || color === COLORS.CAPTURE
		))).toBe(true);
	});

	test('keeps one frozen presentation across a rapid 100→110→100 reversal while serializing physical ACKs', async () => {
		const harness = installHarness();
		const state = createState();
		const frames: number[] = [];
		const update = createUpdateFn(state, 18, () => false, () => {
			frames.push(resolveVolumePresentation(state).effectiveVolume);
		}, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 110 });
		const firstDrain = update.flush();
		await waitFor(() => harness.requests.length === 1);
		// The boundary crossing freezes the complete last-acknowledged value/color
		// pair until the physical route ACK lands; the optimistic 110 never shows.
		expect(frames.at(-1)).toBe(100);

		update({ volume: 100 });
		const finalDrain = update.flush();
		expect(frames.at(-1)).toBe(100);
		// The second physical write waits for the first ACK while the frozen
		// presentation stays on the acknowledged pair.
		expect(harness.requests).toHaveLength(1);

		harness.resolveRequest(0, runtimeResponse(110, 1, 'capture'));
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(100);
		expect(frames.at(-1)).toBe(100);

		harness.resolveRequest(1, runtimeResponse(100, 2, 'observe'));
		await Promise.all([firstDrain, finalDrain]);
		expect(state.config.volume).toBe(100);
		expect(state.stableConfig.volume).toBe(100);
		expect(frames.at(-1)).toBe(100);
	});

	test('sends a reversal batched during flight immediately when the ACK lands, not after the idle-gap window', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 19, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 110 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);

		update({ volume: 100 });
		// The reversal is coalesced into pending; no second timer can exist while
		// the first request is still in flight.
		expect(harness.timers.size).toBe(0);

		harness.resolveRequest(0, runtimeResponse(110, 1, 'capture'));
		await waitFor(() => harness.timers.size === 1);
		// The in-flight round already imposed the send gap, so the return swing
		// must be scheduled with no artificial min-send window at all.
		expect(harness.timerDelay()).toBe(0);

		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(100);
		harness.resolveRequest(1, runtimeResponse(100, 2, 'observe'));
		await waitFor(() => state.controlGeneration === 2);
		expect(state.config.volume).toBe(100);
	});

	test('commits an above-100 Media WebAudio ACK directly as blue', async () => {
		const harness = installHarness();
		const state = createState();
		const frames: Array<{ volume: number; color: string }> = [];
		const update = createUpdateFn(state, 16, () => false, () => {
			const presentation = resolveVolumePresentation(state);
			frames.push({
				volume: presentation.effectiveVolume,
				color: presentation.color,
			});
		}, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 110 });
		expect(frames.at(-1)).toEqual({ volume: 100, color: COLORS.NATIVE });
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		harness.resolveRequest(0, runtimeResponse(110, 1, 'media-webaudio'));
		await drained;

		expect(frames.at(-1)).toEqual({ volume: 110, color: COLORS.NATIVE });
		expect(frames).not.toContainEqual({ volume: 110, color: COLORS.CAPTURE });
	});

	test('requeues DSP fields when the compound volume operation is rejected', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 17, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);
		const eqValues = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

		update({ volume: 200 });
		update({ eqValues });
		const rejected = update.flush();
		await waitFor(() => harness.requests.length === 1);
		harness.resolveRequest(0, {
			ok: false,
			error: { code: 'control_failed', message: 'volume unavailable', retryable: true },
		});
		await expect(rejected).rejects.toThrow('volume unavailable');

		// A newer explicit update retries the preserved DSP intent; it was not
		// consumed together with the failed independent volume operation.
		update({ bass: true });
		const retry = update.flush();
		await waitFor(() => harness.requests.length === 2);
		const payload = requestPayload(harness.requests[1]?.message);
		expect(payload.patch).toMatchObject({ eqValues, bass: true });
		harness.resolveRequest(1, intentResponse(1, eqValues));
		await retry;
	});

	test('preserves the rejected ordinary DSP group for the next explicit flush', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 18, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);
		const eqValues = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0];

		update({ eqValues, compressor: true });
		const rejected = update.flush();
		await waitFor(() => harness.requests.length === 1);
		harness.resolveRequest(0, {
			ok: false,
			error: { code: 'control_failed', message: 'DSP unavailable', retryable: true },
		});
		await expect(rejected).rejects.toThrow('DSP unavailable');

		update({ pan: 0.5 });
		const retry = update.flush();
		await waitFor(() => harness.requests.length === 2);
		const payload = requestPayload(harness.requests[1]?.message);
		expect(payload.patch).toMatchObject({ eqValues, compressor: true, pan: 0.5 });
		harness.resolveRequest(1, intentResponse(2, eqValues));
		await retry;
	});
});

function intentResponse(revision: number, eqValues: number[]): Record<string, unknown> {
	return {
		ok: true,
		data: {
			intentId: `intent-${revision}`,
			tabId: 1,
			documentId: 'document-popup',
			generation: revision,
			revision,
			target: null,
			fields: {
				eqValues: {
					desired: eqValues,
					actual: eqValues,
					revision,
					phase: 'applied',
					strategy: 'capture',
					coverage: 'full',
					controlled: true,
					intentId: `intent-${revision}`,
					lastError: null,
				},
			},
			audioVolume: undefined,
		},
	};
}

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		stableConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		controlSnapshot: null,
		isCaptureActive: false,
		userInteracted: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		controlGeneration: 0,
		controlRevision: 0,
		audioDocumentId: null,
		audioOrigin: null,
		audioGeneration: 0,
		audioConfigRevision: 0,
		lastError: null,
		isDragging: false,
		draggingField: null,
	};
}

function runtimeResponse(
	effectiveVolume: number,
	generation: number,
	strategy?: 'capture' | 'media-webaudio' | 'observe' | 'page-native',
): Record<string, unknown> {
	const pageNative = strategy === 'page-native';
	const volumeBase = pageNative ? effectiveVolume : effectiveVolume <= 100 ? effectiveVolume : 100;
	const boost = pageNative || effectiveVolume <= 100 ? 1 : effectiveVolume / 100;
	return {
		ok: true,
		data: {
			operationId: `operation-${generation}`,
			tabId: 1,
			documentId: 'document-popup',
			generation,
			revision: generation,
			target: null,
			operation: 'effective-volume',
			strategy: 'extension-state',
			coverage: boost > 1 ? 'full' : 'active-target',
			fields: strategy ? {
				[pageNative ? 'volumeBase' : 'boost']: {
					desired: pageNative ? volumeBase : boost,
					actual: pageNative ? volumeBase : boost,
					revision: generation,
					phase: 'applied',
					strategy,
					coverage: pageNative ? 'active-target' : 'full',
					controlled: strategy !== 'observe',
					intentId: `intent-${generation}`,
					lastError: null,
				},
			} : {},
			result: { effectiveVolume, volumeBase, boost },
		},
	};
}

function requestPayload(message: unknown): Record<string, unknown> {
	if (!message || typeof message !== 'object') return {};
	const payload = (message as { payload?: unknown }).payload;
	return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

function requestVolume(message: unknown): unknown {
	const payload = requestPayload(message).payload;
	return payload && typeof payload === 'object'
		? (payload as { value?: unknown }).value
		: undefined;
}

function requestType(message: unknown): unknown {
	return message && typeof message === 'object'
		? (message as { type?: unknown }).type
		: undefined;
}

function installHarness() {
	const timers = new Map<number, { callback: () => void; delay: number }>();
	const requests: Array<{ message: unknown; resolve: (value: unknown) => void }> = [];
	const runtimeRequests: Array<Record<string, unknown>> = [];
	let timerId = 0;
	let now = 0;
	const fakeWindow = new EventTarget();

	Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
	Object.defineProperty(globalThis, 'performance', {
		configurable: true,
		value: { now: () => now },
	});
	Object.defineProperty(globalThis, 'setTimeout', {
		configurable: true,
		value: (callback: () => void, delay?: number) => {
			const id = ++timerId;
			timers.set(id, { callback, delay: delay ?? 0 });
			return id;
		},
	});
	Object.defineProperty(globalThis, 'clearTimeout', {
		configurable: true,
		value: (id: number) => timers.delete(id),
	});
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				sendMessage: (message: Record<string, unknown>) => {
					if (message.type === 'spectra.audio.session.flush') {
						runtimeRequests.push(message);
						return Promise.resolve({ ok: true, data: { flushed: true } });
					}
					return new Promise((resolve) => {
						requests.push({ message, resolve });
					});
				},
			},
		},
	});

	return {
		window: fakeWindow,
		timers,
		requests,
		runtimeRequests,
		fireOnlyTimer() {
			expect(timers.size).toBe(1);
			const [id, timer] = requireValue(
				[...timers.entries()][0],
				'Expected exactly one pending popup coalescing timer',
			);
			timers.delete(id);
			now += 50;
			timer.callback();
		},
		timerDelay() {
			expect(timers.size).toBe(1);
			const [, timer] = requireValue(
				[...timers.entries()][0],
				'Expected exactly one pending popup coalescing timer',
			);
			return timer.delay;
		},
		resolveRequest(index: number, response: unknown) {
			const request = requests[index];
			if (!request) throw new Error(`Missing request ${index}`);
			request.resolve(response);
		},
	};
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function restoreProperty(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
