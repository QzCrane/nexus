import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { audioHandlerTestApi } from '../src/background/handlers/audio';
import { captureStates } from '../src/background/state';

interface OffscreenMessage {
	type: string;
	tabIds?: number[];
	target?: string;
}

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
let requests: number[][];
let sendMessage: (message: OffscreenMessage) => Promise<unknown>;

function installChrome(): void {
	requests = [];
	sendMessage = async (message) => {
		if (message.type !== 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS') {
			throw new Error(`Unexpected offscreen message: ${message.type}`);
		}
		const tabIds = [...message.tabIds ?? []];
		requests.push(tabIds);
		return { subscribedTabIds: tabIds };
	};
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				id: 'spectra-test',
				getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
				getContexts: async () => [{}],
				sendMessage: (message: OffscreenMessage) => sendMessage(message),
			},
		},
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

describe('background Capture visualizer lifecycle', () => {
	beforeEach(() => installChrome());

	afterEach(async () => {
		await audioHandlerTestApi.reset();
		captureStates.clear();
		if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
		else Reflect.deleteProperty(globalThis, 'chrome');
	});

	test('subscribes only acknowledged Capture processors and retries a mismatched host ACK', async () => {
		await audioHandlerTestApi.reconcileVisualizerSubscriptions([7, 11]);
		expect(requests).toEqual([[7, 11]]);

		sendMessage = async (message) => {
			const tabIds = [...message.tabIds ?? []];
			requests.push(tabIds);
			return { subscribedTabIds: [] };
		};
		await audioHandlerTestApi.reconcileVisualizerSubscriptions([12]);
		await audioHandlerTestApi.reconcileVisualizerSubscriptions([12]);
		expect(requests).toEqual([[7, 11], [12], [12]]);
	});

	test('serializes tab removal behind an in-flight offscreen reconciliation', async () => {
		captureStates.set(7, true);
		captureStates.set(8, true);
		audioHandlerTestApi.seedVisualizerSubscriber('popup-test', 1, [7, 8]);
		const firstStarted = deferred<void>();
		const releaseFirst = deferred<void>();
		let call = 0;
		sendMessage = async (message) => {
			const tabIds = [...message.tabIds ?? []];
			requests.push(tabIds);
			call += 1;
			if (call === 1) {
				firstStarted.resolve();
				await releaseFirst.promise;
			}
			return { subscribedTabIds: tabIds };
		};

		const reconciliation = audioHandlerTestApi.reconcileVisualizerSubscriptions([7, 8]);
		await firstStarted.promise;
		const removal = audioHandlerTestApi.handleVisualizerTabRemoved(7);
		await Promise.resolve();
		expect(requests).toEqual([[7, 8]]);

		releaseFirst.resolve();
		await Promise.all([reconciliation, removal]);
		expect(requests).toEqual([[7, 8], [8]]);
	});
});
