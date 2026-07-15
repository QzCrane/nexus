import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, DEFAULT_GLOBAL_SETTINGS } from '@nexus/contracts';
import { createUpdateFn } from '../src/popup/card/state';
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

		for (let index = 0; index < 100; index += 1) update({ volume: 100 + index });
		expect(harness.timers.size).toBe(1);
		expect(harness.requests).toHaveLength(0);
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		expect(requestVolume(harness.requests[0]?.message)).toBe(199);
		harness.resolveRequest(0, runtimeResponse(199, 1));
		await waitFor(() => state.generation === 1);
		expect(harness.requests).toHaveLength(1);
	});

	test('keeps newer optimistic values when an older ACK arrives', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 7, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 110 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);

		update({ volume: 120 });
		update({ volume: 130 });
		harness.resolveRequest(0, runtimeResponse(110, 1));
		await waitFor(() => harness.timers.size === 1);
		expect(state.config.volume).toBe(130);

		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(130);
		harness.resolveRequest(1, runtimeResponse(130, 2));
		await waitFor(() => state.generation === 2);
		expect(state.config.volume).toBe(130);
	});

	test('drains a pending latest value after an in-flight request on pagehide', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 9, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 150 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		update({ volume: 175 });
		harness.window.dispatchEvent(new Event('pagehide'));

		harness.resolveRequest(0, runtimeResponse(150, 1));
		await waitFor(() => harness.requests.length === 2);
		expect(requestVolume(harness.requests[1]?.message)).toBe(175);
		expect(harness.timers.size).toBe(0);
		harness.resolveRequest(1, runtimeResponse(175, 2));
		await waitFor(() => harness.runtimeRequests.length === 1);
		expect(harness.runtimeRequests[0]?.type).toBe('spectra.audio.session.flush');
	});

	test('flushes the final slider value immediately on change', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 11, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volume: 240 });
		expect(harness.timers.size).toBe(1);
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(harness.timers.size).toBe(0);
		expect(requestVolume(harness.requests[0]?.message)).toBe(240);
		harness.resolveRequest(0, runtimeResponse(240, 1));
		await drained;
		expect(state.config.volume).toBe(240);
	});
});

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		isCaptureActive: false,
		userInteracted: false,
		isRestrictedSite: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		generation: 0,
		lastError: null,
		isDragging: false,
	};
}

function runtimeResponse(volume: number, generation: number): Record<string, unknown> {
	return {
		ok: true,
		data: {
			config: { ...DEFAULT_AUDIO_CONFIG, volume, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			hasAudio: true,
			isPlaying: true,
			desiredMode: 'webaudio',
			actualMode: 'webaudio',
			phase: 'active',
			generation,
			userInteracted: true,
			pausedAt: null,
			lastError: null,
		},
	};
}

function requestVolume(message: unknown): unknown {
	if (!message || typeof message !== 'object') return undefined;
	const payload = (message as { payload?: unknown }).payload;
	if (!payload || typeof payload !== 'object') return undefined;
	const config = (payload as { config?: unknown }).config;
	return config && typeof config === 'object' ? (config as { volume?: unknown }).volume : undefined;
}

function installHarness() {
	const timers = new Map<number, () => void>();
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
		value: (callback: () => void) => {
			const id = ++timerId;
			timers.set(id, callback);
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
				sendMessage: async (message: Record<string, unknown>) => {
					runtimeRequests.push(message);
					return { ok: true, data: { flushed: true } };
				},
			},
			tabs: {
				sendMessage: (_tabId: number, message: unknown) => new Promise((resolve) => {
					requests.push({ message, resolve });
				}),
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
			const [id, callback] = [...timers.entries()][0]!;
			timers.delete(id);
			now += 50;
			callback();
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
