import { afterEach, describe, expect, test } from 'bun:test';
import type { ControlSnapshot, MediaTarget, VideoFilterState } from '@nexus/contracts';
import {
	bindVideoControls,
	setVideoControlTabId,
	syncVideoControlSnapshot,
} from '../src/popup/side-panel/video-controls';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalSetTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
const originalClearTimeout = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');

class FakeInput {
	value: string;
	checked: boolean;
	oninput: (() => void) | null = null;
	onchange: (() => void) | null = null;

	constructor(value: string, checked = false) {
		this.value = value;
		this.checked = checked;
	}
}

class FakePanel {
	readonly brightness = new FakeInput('100');
	readonly contrast = new FakeInput('100');
	readonly saturate = new FakeInput('100');
	readonly grayscale = new FakeInput('', false);
	readonly invert = new FakeInput('', false);

	querySelector<T>(selector: string): T | null {
		const input = new Map<string, FakeInput>([
			['.sp-brightness', this.brightness],
			['.sp-contrast', this.contrast],
			['.sp-saturate', this.saturate],
			['.sp-sw-grayscale', this.grayscale],
			['.sp-sw-invert', this.invert],
		]).get(selector);
		return (input ?? null) as T | null;
	}

	querySelectorAll<T>(_selector: string): T[] {
		return [];
	}
}

afterEach(() => {
	setVideoControlTabId(-1);
	restore('chrome', originalChrome);
	restore('document', originalDocument);
	restore('window', originalWindow);
	restore('performance', originalPerformance);
	restore('setTimeout', originalSetTimeout);
	restore('clearTimeout', originalClearTimeout);
});

describe('Popup video control transport', () => {
	test('coalesces Filter at 20 Hz and commits values plus enabled state in one intent', async () => {
		const panel = new FakePanel();
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:video-controls',
			mediaId: 'media:video-controls',
			sourceRevision: 2,
			kind: 'video',
		};
		const snapshot: ControlSnapshot = {
			tabId: 7,
			documentId: target.documentId,
			origin: 'https://media.example',
			generation: 3,
			revision: 4,
			activeMedia: null,
			activeVideo: target,
			fields: {},
		};

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(snapshot);
		for (let value = 1; value <= 100; value += 1) {
			panel.brightness.value = String(value);
			panel.brightness.oninput?.();
		}
		expect(harness.timers.size).toBe(1);
		expect(harness.requests).toHaveLength(0);
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		expect(controlPayload(harness.requests[0]?.message)).toMatchObject({
			tabId: 7,
			target,
			baseRevision: 4,
			patch: {
				filterEnabled: true,
				filter: {
					brightness: 100,
					contrast: 100,
					saturate: 100,
					grayscale: false,
					invert: false,
				},
			},
		});
		expect(controlPayload(harness.requests[0]?.message).mutations).toBeUndefined();

		// While the first request is unresolved, only the latest value survives.
		panel.brightness.value = '150';
		panel.brightness.oninput?.();
		panel.brightness.value = '200';
		panel.brightness.oninput?.();
		expect(harness.timers.size).toBe(1);
		// A scheduled flush while the first request is active keeps the pending
		// value instead of opening a second in-flight request.
		harness.fireOnlyTimer();
		expect(harness.requests).toHaveLength(1);
		expect(harness.timers.size).toBe(0);
		harness.resolveRequest(0, target, 5);
		await waitFor(() => harness.timers.size === 1);
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 2);
		expect(filterPatch(harness.requests[1]?.message)).toEqual({
			filter: {
				brightness: 200,
				contrast: 100,
				saturate: 100,
				grayscale: false,
				invert: false,
			},
			filterEnabled: true,
		});
		harness.resolveRequest(1, target, 6);
		await waitFor(() => harness.timers.size === 0);
	});
});

function installHarness(panel: FakePanel) {
	const timers = new Map<number, () => void>();
	const requests: Array<{ message: unknown; resolve: (response: unknown) => void }> = [];
	let nextTimerId = 0;
	let now = 0;
	const fakeWindow = new EventTarget();
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			activeElement: null,
			getElementById: (id: string) => id === 'side-panel' ? panel : null,
		},
	});
	Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
	Object.defineProperty(globalThis, 'performance', {
		configurable: true,
		value: { now: () => now },
	});
	Object.defineProperty(globalThis, 'setTimeout', {
		configurable: true,
		value: (callback: () => void) => {
			const id = ++nextTimerId;
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
				sendMessage: (message: unknown) => new Promise((resolve) => {
					requests.push({ message, resolve });
				}),
			},
		},
	});
	return {
		timers,
		requests,
		fireOnlyTimer() {
			expect(timers.size).toBe(1);
			const [id, callback] = [...timers.entries()][0]!;
			timers.delete(id);
			now += 50;
			callback();
		},
		resolveRequest(index: number, target: MediaTarget, revision: number) {
			const request = requests[index];
			if (!request) throw new Error(`Missing request ${index}`);
			const patch = filterPatch(request.message);
			const filter = patch.filter as VideoFilterState;
			request.resolve({
				ok: true,
				data: {
					intentId: `filter:${revision}`,
					tabId: 7,
					documentId: target.documentId,
					generation: 3,
					revision,
					target,
					fields: {
						filter: fieldState(filter, revision, `filter:${revision}`),
						filterEnabled: fieldState(true, revision, `filter:${revision}`),
					},
				},
			});
		},
	};
}

function fieldState(actual: unknown, revision: number, intentId: string) {
	return {
		desired: actual,
		actual,
		revision,
		phase: 'applied',
		strategy: 'extension-css',
		coverage: 'active-target',
		controlled: true,
		intentId,
		lastError: null,
	};
}

function controlPayload(message: unknown): Record<string, unknown> {
	if (!message || typeof message !== 'object') return {};
	const payload = (message as { payload?: unknown }).payload;
	return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

function filterPatch(message: unknown): Record<string, unknown> {
	const patch = controlPayload(message).patch;
	return patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
