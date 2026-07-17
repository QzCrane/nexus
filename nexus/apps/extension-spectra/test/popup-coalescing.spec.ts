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

		for (let index = 0; index < 100; index += 1) update({ volumeBase: index + 1 });
		expect(harness.timers.size).toBe(1);
		expect(harness.requests).toHaveLength(0);
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		expect(requestVolume(harness.requests[0]?.message)).toBe(100);
		harness.resolveRequest(0, runtimeResponse(100, 1));
		await waitFor(() => state.controlGeneration === 1);
		expect(harness.requests).toHaveLength(1);
	});

	test('keeps newer optimistic values when an older ACK arrives', async () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdateFn(state, 7, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volumeBase: 10 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);

		update({ volumeBase: 20 });
		update({ volumeBase: 30 });
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

		update({ volumeBase: 50 });
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		update({ volumeBase: 75 });
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

		update({ volumeBase: 40 });
		expect(harness.timers.size).toBe(1);
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(harness.timers.size).toBe(0);
		expect(requestVolume(harness.requests[0]?.message)).toBe(40);
		harness.resolveRequest(0, runtimeResponse(40, 1));
		await drained;
		expect(state.config.volumeBase).toBe(40);
	});

	test('changes page volume and Boost without implicitly clearing media mute', async () => {
		const harness = installHarness();
		const state = createState();
		state.config.muted = true;
		state.stableConfig.muted = true;
		const update = createUpdateFn(state, 12, () => false, () => undefined, () => DEFAULT_GLOBAL_SETTINGS);

		update({ volumeBase: 40, boost: 2 });
		const drained = update.flush();
		await waitFor(() => harness.requests.length === 1);
		expect(requestPatch(harness.requests[0]?.message)).toEqual({ volumeBase: 40 });
		harness.resolveRequest(0, runtimeResponse(40, 1));
		await waitFor(() => harness.requests.length === 2);
		expect(requestPatch(harness.requests[1]?.message)).toEqual({ boost: 2 });
		harness.resolveRequest(1, runtimeBoostResponse(2, 2));
		await drained;

		expect(state.config.muted).toBe(true);
		expect(state.stableConfig.muted).toBe(true);
		expect(harness.requests.every(({ message }) => (
			(requestPatch(message) as { mediaMuted?: unknown }).mediaMuted === undefined
		))).toBe(true);
	});
});

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		stableConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		controlSnapshot: null,
		isCaptureActive: false,
		userInteracted: false,
		isRestrictedSite: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		controlGeneration: 0,
		controlRevision: 0,
		audioGeneration: 0,
		audioConfigRevision: 0,
		lastError: null,
		isDragging: false,
		draggingField: null,
	};
}

function runtimeResponse(volumeBase: number, generation: number): Record<string, unknown> {
	return {
		ok: true,
		data: {
			intentId: `intent-${generation}`,
			tabId: 1,
			documentId: 'document-popup',
			generation,
			revision: generation,
			target: null,
			fields: {
				volumeBase: {
					desired: volumeBase,
					actual: volumeBase,
					revision: generation,
					phase: 'applied',
					strategy: 'dom-native',
					coverage: 'active-target',
					controlled: true,
					intentId: `intent-${generation}`,
					lastError: null,
				},
			},
		},
	};
}

function runtimeBoostResponse(boost: number, generation: number): Record<string, unknown> {
	return {
		ok: true,
		data: {
			intentId: `boost-${generation}`,
			tabId: 1,
			documentId: 'document-popup',
			generation,
			revision: generation,
			target: null,
			fields: {
				boost: {
					desired: boost,
					actual: boost,
					revision: generation,
					phase: 'applied',
					strategy: 'media-webaudio',
					coverage: 'full',
					controlled: true,
					intentId: `boost-${generation}`,
					lastError: null,
				},
			},
		},
	};
}

function requestPatch(message: unknown): Record<string, unknown> {
	if (!message || typeof message !== 'object') return {};
	const payload = (message as { payload?: unknown }).payload;
	if (!payload || typeof payload !== 'object') return {};
	const patch = (payload as { patch?: unknown }).patch;
	return patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
}

function requestVolume(message: unknown): unknown {
	return requestPatch(message).volumeBase;
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
