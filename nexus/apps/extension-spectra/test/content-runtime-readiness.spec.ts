import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
			patch: { volumeBase: 64, mediaMuted: true },
			observedStrategies: { volumeBase: 'dom-native', mediaMuted: 'dom-native' },
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
});

class FakeMediaElement extends EventTarget {
	isConnected = true;
	muted = false;
	volume = 1;
	playbackRate = 1;
	preservesPitch = true;
	paused = true;
	ended = false;
}

function installBootstrapHarness() {
	const media = new FakeMediaElement();
	const fakeWindow = new EventTarget() as Window & {
		__SPECTRA_CONTENT_BOOTSTRAP__?: { dispose(): void };
	};
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
					if (message.type === 'spectra.control.intent.submit') intents.push(message);
					return Promise.resolve({ ok: true, data: {} });
				},
			} },
		},
	});
	return {
		media,
		intents,
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

async function importFreshBootstrap(label: string): Promise<void> {
	const path = resolve(import.meta.dir, '../src/content/core/bootstrap.ts');
	await import(`${pathToFileURL(path).href}?test=${label}-${crypto.randomUUID()}`);
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition did not become true');
}
