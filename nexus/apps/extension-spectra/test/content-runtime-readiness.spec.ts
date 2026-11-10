import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { claimMediaObservationEpoch, type ContentBootstrapState } from '../src/shared/content-runtime';

const originalGlobals = new Map(
	['window', 'document', 'chrome', 'HTMLMediaElement']
		.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const),
);

afterEach(() => {
	const state = (globalThis.window as Window & {
		__SPECTRA_CONTENT_BOOTSTRAP__?: { dispose(): void };
	} | undefined)?.__SPECTRA_CONTENT_BOOTSTRAP__;
	state?.dispose();
	Reflect.deleteProperty(globalThis, '__spectraPhysicalHotkeyReleaseV1');
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

describe('content runtime readiness boundary', () => {
	test('drains only the latest native observation after a deferred lean HELLO', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('lean-observation');

		harness.media.muted = true;
		harness.dispatchNativeChange('volumechange');
		harness.media.volume = 0.64;
		harness.dispatchNativeChange('volumechange');
		expect(harness.intents).toHaveLength(0);

		harness.resolveHello(null);
		await waitFor(() => harness.intents.length === 1);
		expect(harness.intents[0]?.payload).toMatchObject({
			patch: { volumeBase: 64, mediaMuted: true, speed: 1, preservePitch: true },
			observedStrategies: { volumeBase: 'dom-native', mediaMuted: 'dom-native' },
			mediaObservation: { epoch: 1, selection: 1, revision: 1 },
		});
		await Promise.resolve();
		expect(harness.intents).toHaveLength(1);
	});

	test('drops a buffered bootstrap observation when HELLO transfers ownership to runtime', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('runtime-takeover');

		harness.media.muted = true;
		harness.dispatchNativeChange('volumechange');
		harness.resolveHello('runtime-1');
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.intents).toHaveLength(0);
	});

	test('claims a later epoch after full-runtime disposal and never steals loading ownership', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('owner-handoff'); harness.resolveHello(null);
		harness.dispatchNativeChange('volumechange');
		await waitFor(() => harness.intents.length === 1);
		const state = harness.state();
		state.disposeRuntime = async () => undefined;
		expect(claimMediaObservationEpoch()).toBe(2);
		harness.media.volume = 0.55; harness.dispatchNativeChange('volumechange');
		await Promise.resolve();
		expect(harness.intents).toHaveLength(1);
		delete state.disposeRuntime;
		harness.media.volume = 0.33; harness.dispatchNativeChange('volumechange');
		await waitFor(() => harness.intents.length === 2);
		expect(harness.intents[1]?.payload).toMatchObject({ patch: { volumeBase: 33 },
			mediaObservation: { epoch: 3, selection: 1, revision: 1 } });
		expect(claimMediaObservationEpoch()).toBe(4);
	});

	test('rereads both native groups when a queued event waits behind an in-flight observation', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('pending-sampling'); harness.resolveHello(null);
		const release = harness.holdNextObservation();
		harness.media.volume = 0.55; harness.dispatchNativeChange('volumechange');
		await waitFor(() => harness.intents.length === 1);
		harness.media.volume = 0.33; harness.dispatchNativeChange('volumechange');
		harness.media.playbackRate = 2; harness.dispatchNativeChange('ratechange');
		// A deferred obligation samples current getters, not its older event data.
		harness.media.volume = 0.27;
		release();
		await waitFor(() => harness.intents.length === 2);
		expect(harness.intents[1]?.payload).toMatchObject({
			patch: { volumeBase: 27, mediaMuted: false, speed: 2, preservePitch: true },
			mediaObservation: { epoch: 1, selection: 2, revision: 2 },
		});
	});
});

class FakeMediaElement extends EventTarget {
	isConnected = true;
	muted = false;
	volume = 1;
	playbackRate = 1;
	preservesPitch = true;
	paused = true;
	ended = false;
	getBoundingClientRect() { return { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 }; }
}

function installBootstrapHarness() {
	const media = new FakeMediaElement();
	const fakeWindow = new EventTarget() as Window & {
		__SPECTRA_CONTENT_BOOTSTRAP__?: ContentBootstrapState;
	};
	Object.assign(fakeWindow, { innerWidth: 1280, innerHeight: 720 });
	const fakeDocument = new EventTarget() as Document;
	Object.assign(fakeDocument, {
		readyState: 'complete',
		hidden: false,
		fullscreenElement: null,
		pictureInPictureElement: null,
		querySelector: (selector: string) => selector.includes('video') ? media : null,
		querySelectorAll: (selector: string) => selector === 'video,audio' ? [media] : [],
	});
	let resolveHello!: (response: unknown) => void;
	const hello = new Promise<unknown>((resolvePromise) => { resolveHello = resolvePromise; });
	const intents: Array<{ type: string; payload: Record<string, unknown> }> = [];
	let nextObservation: Promise<unknown> | null = null;
	const onMessage = new Set<(...args: never[]) => unknown>();
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: fakeWindow },
		document: { configurable: true, value: fakeDocument },
		HTMLMediaElement: { configurable: true, value: FakeMediaElement },
		chrome: {
			configurable: true,
			value: { runtime: {
				id: 'extension-id',
				onMessage: {
					addListener: (listener: (...args: never[]) => unknown) => onMessage.add(listener),
					removeListener: (listener: (...args: never[]) => unknown) => onMessage.delete(listener),
				},
				sendMessage: (message: { type: string; payload: Record<string, unknown> }) => {
					if (message.type === 'spectra.content.bootstrap.hello') return hello;
					if (message.type === 'spectra.control.intent.submit') {
						intents.push(message);
						const pending = nextObservation; nextObservation = null;
						if (pending) return pending;
					}
					return Promise.resolve({ ok: true, data: {} });
				},
			} },
		},
	});
	return {
		media,
		intents,
		state() {
			if (!fakeWindow.__SPECTRA_CONTENT_BOOTSTRAP__) throw new Error('Bootstrap not installed');
			return fakeWindow.__SPECTRA_CONTENT_BOOTSTRAP__;
		},
		holdNextObservation() {
			let release!: () => void;
			nextObservation = new Promise(resolve => { release = () => resolve({ ok: true, data: {} }); });
			return release;
		},
		dispatchNativeChange(type: 'volumechange' | 'ratechange') {
			const event = new Event(type);
			Object.defineProperty(event, 'composedPath', { value: () => [media, fakeDocument, fakeWindow] });
			fakeDocument.dispatchEvent(event);
		},
		resolveHello(runtimeRevision: string | null) {
			resolveHello({
				ok: true,
				data: { accepted: true, runtimeRevision },
			});
		},
	};
}

let bootstrapCode: Promise<string> | undefined;
async function importFreshBootstrap(label: string): Promise<void> {
	// Bun caches the same filesystem module even with a URL query. Execute a
	// fresh IIFE so every case actually installs its own document-start host;
	// otherwise a zero-message assertion can pass without running any code.
	bootstrapCode ??= Bun.build({ entrypoints: [resolve(import.meta.dir, '../src/content/core/bootstrap.ts')],
		target: 'browser', format: 'iife' }).then(async result => {
		if (!result.success || !result.outputs[0]) throw new Error(`Bootstrap fixture build failed: ${result.logs.join('\n')}`);
		return result.outputs[0].text();
	});
	runInThisContext(await bootstrapCode, { filename: `bootstrap-${label}.js` });
	if (!(globalThis.window as Window & { __SPECTRA_CONTENT_BOOTSTRAP__?: unknown }).__SPECTRA_CONTENT_BOOTSTRAP__) {
		throw new Error('The fresh bootstrap did not install');
	}
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition did not become true');
}
