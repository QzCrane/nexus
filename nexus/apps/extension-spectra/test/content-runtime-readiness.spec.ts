import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import {
	claimMediaObservationEpoch,
	noteMediaUserGesture,
	setContentNativeMediaObserver,
	type ContentBootstrapState,
} from '../src/shared/content-runtime';

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
		// Autoplay/player setup changes volume without trusted input; it may sync
		// but it must not claim a gesture that could make the badge appear.
		expect(harness.intents[0]?.payload.userGesture).toBeUndefined();
	});

	test('carries the viewer gesture witness on a buffered volume change', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('gesture-witness');
		noteMediaUserGesture();
		harness.media.volume = 0.31;
		harness.dispatchNativeChange('volumechange');
		harness.resolveHello(null);
		await waitFor(() => harness.intents.length === 1);
		expect(harness.intents[0]?.payload).toMatchObject({
			userGesture: true,
			patch: { volumeBase: 31 },
		});
	});

	test('retries a routed HELLO that lost the document identity race', async () => {
		const harness = installBootstrapHarness();
		harness.failHelloOnce();
		await importFreshBootstrap('hello-retry');

		// The first handshake is rejected while the same-tab route is committing.
		// The buffered volume change must survive that rejection and drain once the
		// retried handshake lands, without any pause/play or Popup.
		harness.media.volume = 0.42;
		harness.dispatchNativeChange('volumechange');
		await new Promise((resolveTick) => setTimeout(resolveTick, 220));
		harness.resolveHello(null);
		await waitFor(() => harness.intents.length === 1);
		expect(harness.intents[0]?.payload).toMatchObject({ patch: { volumeBase: 42 } });
	});

	test('keeps observing when the runtime handshake lands but no media is registered', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('runtime-blind');

		// A ready runtime that never registered this document's player is not the
		// observation owner. The document-start observer must keep submitting.
		harness.media.muted = true;
		harness.dispatchNativeChange('volumechange');
		harness.resolveHello('runtime-1');
		await waitFor(() => harness.intents.length === 1);
		expect(harness.intents[0]?.payload).toMatchObject({ patch: { mediaMuted: true } });
	});

	test('drops a buffered bootstrap observation once the runtime registers media', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('runtime-takeover');

		harness.media.muted = true;
		harness.state().runtimeObservesMedia = true;
		harness.dispatchNativeChange('volumechange');
		harness.resolveHello('runtime-1');
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.intents).toHaveLength(0);
	});

	test.each([false, true])('forwards captured changes to the runtime without a second owner (registered=%s)', async observing => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap(`forward-${observing}`);
		harness.resolveHello('runtime-1');
		harness.state().runtimeObservesMedia = observing;
		const epoch = claimMediaObservationEpoch();
		const events: Array<{ element: HTMLMediaElement; type: string }> = [];
		const release = setContentNativeMediaObserver((element, type) => events.push({ element, type }));
		noteMediaUserGesture();
		harness.media.volume = 0.31;
		harness.dispatchNativeChange('volumechange');
		harness.dispatchNativeChange('ratechange');
		await Promise.resolve();
		expect(events).toEqual([
			{ element: harness.media, type: 'volumechange' },
			{ element: harness.media, type: 'ratechange' },
		]);
		expect(harness.state().mediaOwnerEpoch).toBe(epoch);
		expect(harness.intents).toHaveLength(0);
		release();
	});

	test('an old runtime cleanup cannot remove its replacement observer', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('observer-replacement');
		const releaseOld = setContentNativeMediaObserver(() => undefined);
		let events = 0;
		const releaseCurrent = setContentNativeMediaObserver(() => { events += 1; });
		releaseOld();
		harness.dispatchNativeChange('volumechange');
		expect(events).toBe(1);
		releaseCurrent();
		expect(harness.state().observeNativeMediaChange).toBeUndefined();
	});

	test('an in-flight bootstrap sample cannot reclaim ownership after runtime handoff', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('in-flight-handoff');
		harness.resolveHello(null);
		const releaseSample = harness.holdNextObservation();
		harness.dispatchNativeChange('volumechange');
		await waitFor(() => harness.intents.length === 1);
		harness.state().runtimeObservesMedia = true;
		const epoch = claimMediaObservationEpoch();
		let events = 0;
		const releaseObserver = setContentNativeMediaObserver(() => { events += 1; });
		noteMediaUserGesture();
		harness.media.volume = 0.27;
		harness.dispatchNativeChange('volumechange');
		releaseSample();
		await Promise.resolve();
		await Promise.resolve();
		expect(events).toBe(1);
		expect(harness.intents).toHaveLength(1);
		expect(harness.state().mediaOwnerEpoch).toBe(epoch);
		releaseObserver();
	});

	test('claims a later epoch after the runtime stops observing media', async () => {
		const harness = installBootstrapHarness();
		await importFreshBootstrap('owner-handoff'); harness.resolveHello(null);
		harness.dispatchNativeChange('volumechange');
		await waitFor(() => harness.intents.length === 1);
		const state = harness.state();
		state.runtimeObservesMedia = true;
		expect(claimMediaObservationEpoch()).toBe(2);
		harness.media.volume = 0.55; harness.dispatchNativeChange('volumechange');
		await Promise.resolve();
		expect(harness.intents).toHaveLength(1);
		delete state.runtimeObservesMedia;
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
	let helloFailures = 0;
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
					if (message.type === 'spectra.content.bootstrap.hello') {
						if (helloFailures > 0) {
							helloFailures -= 1;
							return Promise.reject(new Error('Stale document identity'));
						}
						return hello;
					}
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
		failHelloOnce() {
			helloFailures += 1;
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
