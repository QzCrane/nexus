import { afterEach, describe, expect, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import type { ControlFieldState, ControlFieldStates, ControlSnapshot, MediaTarget, VideoFilterState } from '@nexus/contracts';
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

/**
 * The side panel schedules its own work at 50ms. Cross-context RPC deadlines are
 * three orders of magnitude longer and are not the scheduling this spec drives by
 * hand, so they are kept out of the timer set the assertions count.
 */
const HARNESS_TIMER_MAX_DELAY_MS = 1_000;

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

class FakeButton {
	readonly dataset: Record<string, string>;
	title = '';
	disabled = false;
	onclick: (() => void) | null = null;
	readonly attributes = new Map<string, string>();
	private active = false;
	readonly classList = {
		contains: (name: string) => name === 'active' && this.active,
		toggle: (name: string, force?: boolean) => {
			if (name === 'active') this.active = force ?? !this.active;
			return this.active;
		},
	};

	constructor(action: string) {
		this.dataset = { action };
	}

	matches(selector: string): boolean {
		return selector === '[data-action]' && this.dataset.action !== undefined;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
}

class FakePanel {
	readonly buttons: FakeButton[];
	readonly brightness = new FakeInput('100');
	readonly contrast = new FakeInput('100');
	readonly saturate = new FakeInput('100');
	readonly grayscale = new FakeInput('', false);
	readonly invert = new FakeInput('', false);

	constructor(buttons: FakeButton[] = []) {
		this.buttons = buttons;
	}

	querySelector<T>(selector: string): T | null {
		const button = this.buttons.find((candidate) => selector === `.sp-btn[data-action="${candidate.dataset.action}"]`);
		if (button) return button as unknown as T;
		const input = new Map<string, FakeInput>([
			['.sp-brightness', this.brightness],
			['.sp-contrast', this.contrast],
			['.sp-saturate', this.saturate],
			['.sp-sw-grayscale', this.grayscale],
			['.sp-sw-invert', this.invert],
		]).get(selector);
		return (input ?? null) as T | null;
	}

	querySelectorAll<T>(selector: string): T[] {
		if (selector.includes('.sp-btn[data-action]')) return this.buttons as unknown as T[];
		return [];
	}
}

class FakeToast {
	className = '';
	textContent = '';
	removed = false;
	readonly attributes = new Map<string, string>();
	readonly classList = { add: (_name: string) => undefined };

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	remove(): void {
		this.removed = true;
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

	test('surfaces a rejected filter mutation instead of reporting silent success', async () => {
		const panel = new FakePanel();
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:video-controls-rejection',
			mediaId: 'media:video-controls-rejection',
			sourceRevision: 1,
			kind: 'video',
		};
		const authoritativeFilter: VideoFilterState = {
			brightness: 100,
			contrast: 100,
			saturate: 100,
			grayscale: false,
			invert: false,
		};
		const snapshot: ControlSnapshot = {
			tabId: 7,
			documentId: target.documentId,
			origin: 'https://media.example',
			generation: 1,
			revision: 2,
			activeMedia: target,
			activeVideo: target,
			fields: {
				filter: fieldState(authoritativeFilter, 2, 'authoritative-filter'),
			},
		};
		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(snapshot);
		panel.brightness.value = '150';
		panel.brightness.oninput?.();
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		harness.rejectRequest(0, 'The active video no longer exists');
		await waitFor(() => harness.toasts.length === 1);
		expect(harness.toasts[0]?.textContent).toBe('The active video no longer exists');
		expect(harness.toasts[0]?.attributes.get('role')).toBe('alert');
		await waitFor(() => harness.requests.length === 2);
		const refresh = requireValue(harness.requests[1], 'Expected authoritative snapshot refresh');
		expect((refresh.message as { type?: unknown }).type).toBe('spectra.control.snapshot.get');
		expect(panel.brightness.value).toBe('100');
		harness.resolveSnapshotRequest(1, snapshot);
		await Promise.resolve();
	});

	test('rebinds only to a newer document generation and rejects delayed old-document events', async () => {
		const panel = new FakePanel();
		const harness = installHarness(panel);
		const firstTarget: MediaTarget = {
			frameId: 0,
			documentId: 'document:first',
			mediaId: 'media:first',
			sourceRevision: 1,
			kind: 'video',
		};
		const secondTarget: MediaTarget = {
			...firstTarget,
			documentId: 'document:second',
			mediaId: 'media:second',
			sourceRevision: 2,
		};
		setVideoControlTabId(7);
		bindVideoControls();
		expect(syncVideoControlSnapshot({
			tabId: 7,
			documentId: firstTarget.documentId,
			origin: 'https://media.example',
			generation: 9,
			revision: 20,
			activeMedia: null,
			activeVideo: firstTarget,
			fields: {},
		})).toBe('accepted');
		expect(syncVideoControlSnapshot({
			tabId: 7,
			documentId: secondTarget.documentId,
			origin: 'https://media.example',
			generation: 10,
			revision: 1,
			activeMedia: null,
			activeVideo: secondTarget,
			fields: {},
		})).toBe('accepted');
		expect(syncVideoControlSnapshot({
			tabId: 7,
			documentId: firstTarget.documentId,
			origin: 'https://media.example',
			generation: 9,
			revision: 99,
			activeMedia: null,
			activeVideo: firstTarget,
			fields: {},
		})).toBe('stale');
		panel.brightness.value = '120';
		panel.brightness.oninput?.();
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		expect(controlPayload(harness.requests[0]?.message)).toMatchObject({
			target: secondTarget,
			baseRevision: 1,
		});
		harness.resolveRequest(0, secondTarget, 2);
		await waitFor(() => harness.timers.size === 0);
	});

	test('serializes filter and discrete writes through one tab transport tail', async () => {
		const rotate = new FakeButton('rotate');
		const panel = new FakePanel([rotate]);
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:cross-lane',
			mediaId: 'media:cross-lane',
			sourceRevision: 1,
			kind: 'video',
		};

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(videoSnapshot(target, 4));
		panel.brightness.value = '130';
		panel.brightness.oninput?.();
		harness.fireOnlyTimer();
		await waitFor(() => harness.requests.length === 1);
		rotate.onclick?.();
		expect(harness.requests).toHaveLength(1);

		harness.resolveRequest(0, target, 5);
		await waitFor(() => harness.requests.length === 2);
		expect(controlPayload(harness.requests[1]?.message).baseRevision).toBe(5);
		harness.resolveMutationRequest(1, target, 6, 90);
		await waitFor(() => harness.requests.length === 2);

		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 3);
		panel.brightness.value = '160';
		panel.brightness.oninput?.();
		harness.fireOnlyTimer();
		expect(harness.requests).toHaveLength(3);
		harness.resolveMutationRequest(2, target, 7, 180);
		await waitFor(() => harness.requests.length === 4);
		expect(controlPayload(harness.requests[3]?.message).baseRevision).toBe(7);
		harness.resolveRequest(3, target, 8);
		await waitFor(() => harness.timers.size === 0);
	});

	test('rebases a new same-tab panel session after an older action settles', async () => {
		const rotate = new FakeButton('rotate');
		const panel = new FakePanel([rotate]);
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:reopen',
			mediaId: 'media:reopen',
			sourceRevision: 1,
			kind: 'video',
		};
		const initial = videoSnapshot(target, 4);

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(initial);
		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 1);

		setVideoControlTabId(null);
		setVideoControlTabId(7);
		syncVideoControlSnapshot(initial);
		rotate.onclick?.();
		expect(harness.requests).toHaveLength(1);

		harness.resolveMutationRequest(0, target, 5, 90);
		await waitFor(() => harness.requests.length === 2);
		const refresh = requireValue(harness.requests[1], 'Expected same-tab authority refresh');
		expect((refresh.message as { type?: unknown }).type).toBe('spectra.control.snapshot.get');
		harness.resolveSnapshotRequest(1, videoSnapshot(target, 5));
		await waitFor(() => harness.requests.length === 3);
		expect(controlPayload(harness.requests[2]?.message).baseRevision).toBe(5);
		harness.resolveMutationRequest(2, target, 6, 180);
		await waitFor(() => harness.requests.length === 3);
		expect(harness.toasts).toHaveLength(0);
	});

	test('does not surface an in-flight action failure after the side panel switches tabs', async () => {
		const rotate = new FakeButton('rotate');
		const panel = new FakePanel([rotate]);
		const harness = installHarness(panel);
		const firstTarget: MediaTarget = {
			frameId: 0,
			documentId: 'document:first-action',
			mediaId: 'media:first-action',
			sourceRevision: 1,
			kind: 'video',
		};
		const secondTarget: MediaTarget = {
			...firstTarget,
			documentId: 'document:second-action',
			mediaId: 'media:second-action',
			sourceRevision: 2,
		};

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(videoSnapshot(firstTarget, 4));
		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 1);

		setVideoControlTabId(8);
		syncVideoControlSnapshot(videoSnapshot(secondTarget, 1, 8));
		harness.rejectRequest(0, 'The first tab video no longer exists');
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.toasts).toHaveLength(0);
		expect(harness.requests).toHaveLength(1);
	});

	test('serializes rapid discrete actions and uses the revision from each ACK', async () => {
		const rotate = new FakeButton('rotate');
		const panel = new FakePanel([rotate]);
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:rapid-action',
			mediaId: 'media:rapid-action',
			sourceRevision: 1,
			kind: 'video',
		};

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(videoSnapshot(target, 4));
		rotate.onclick?.();
		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 1);
		expect(controlPayload(harness.requests[0]?.message)).toMatchObject({
			tabId: 7,
			target,
			baseRevision: 4,
		});

		harness.resolveMutationRequest(0, target, 5, 90);
		await waitFor(() => harness.requests.length === 2);
		expect(controlPayload(harness.requests[1]?.message)).toMatchObject({
			tabId: 7,
			target,
			baseRevision: 5,
		});
		harness.resolveMutationRequest(1, target, 6, 180);
		await waitFor(() => harness.requests.length === 2);
	});

	test('does not let an older ACK regress the revision used by the next action', async () => {
		const rotate = new FakeButton('rotate');
		const panel = new FakePanel([rotate]);
		const harness = installHarness(panel);
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:late-ack',
			mediaId: 'media:late-ack',
			sourceRevision: 1,
			kind: 'video',
		};

		setVideoControlTabId(7);
		bindVideoControls();
		syncVideoControlSnapshot(videoSnapshot(target, 4));
		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 1);
		syncVideoControlSnapshot(videoSnapshot(target, 5));
		harness.resolveMutationRequest(0, target, 4, 90);
		await waitFor(() => harness.requests.length === 1);

		rotate.onclick?.();
		await waitFor(() => harness.requests.length === 2);
		expect(controlPayload(harness.requests[1]?.message).baseRevision).toBe(5);
		harness.resolveMutationRequest(1, target, 6, 180);
		await waitFor(() => harness.requests.length === 2);
	});
});

function installHarness(panel: FakePanel) {
	const timers = new Map<number, () => void>();
	const requests: Array<{ message: unknown; resolve: (response: unknown) => void }> = [];
	const toasts: FakeToast[] = [];
	let nextTimerId = 0;
	let now = 0;
	const fakeWindow = new EventTarget();
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			activeElement: null,
			body: { appendChild: (toast: FakeToast) => toasts.push(toast) },
			createElement: () => new FakeToast(),
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
		value: (callback: () => void, delay = 0) => {
			const id = ++nextTimerId;
			if (delay < HARNESS_TIMER_MAX_DELAY_MS) timers.set(id, callback);
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
		toasts,
		fireOnlyTimer() {
			expect(timers.size).toBe(1);
			const [id, callback] = requireValue(
				[...timers.entries()][0],
				'Expected exactly one pending video-control timer',
			);
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
		resolveMutationRequest(index: number, target: MediaTarget, revision: number, rotation: 0 | 90 | 180 | 270) {
			const request = requests[index];
			if (!request) throw new Error(`Missing request ${index}`);
			const fields: ControlFieldStates = {
				rotation: fieldState(rotation, revision, `rotation:${revision}`),
			};
			request.resolve({
				ok: true,
				data: {
					intentId: `rotation:${revision}`,
					tabId: 7,
					documentId: target.documentId,
					generation: 3,
					revision,
					target,
					fields,
				},
			});
		},
		rejectRequest(index: number, message: string) {
			const request = requests[index];
			if (!request) throw new Error(`Missing request ${index}`);
			request.resolve({
				ok: false,
				error: { code: 'stale_target', message, retryable: true },
			});
		},
		resolveSnapshotRequest(index: number, snapshot: ControlSnapshot) {
			const request = requests[index];
			if (!request) throw new Error(`Missing request ${index}`);
			request.resolve({ ok: true, data: snapshot });
		},
	};
}

function fieldState<T>(actual: T, revision: number, intentId: string): ControlFieldState<T> {
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

function videoSnapshot(target: MediaTarget, revision: number, tabId = 7): ControlSnapshot {
	return {
		tabId,
		documentId: target.documentId,
		origin: 'https://media.example',
		generation: 3,
		revision,
		activeMedia: target,
		activeVideo: target,
		fields: {},
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
