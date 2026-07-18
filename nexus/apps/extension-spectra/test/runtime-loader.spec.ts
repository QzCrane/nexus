import { afterEach, describe, expect, test } from 'bun:test';
import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	type ContentRuntimeSourceOwnership,
	type HotkeySettings,
} from '@nexus/contracts';
import {
	ensureContentRuntime,
	initializeContentRuntimeLoader,
	reconcileHotkeyRuntimeLease,
	releaseContentRuntimeLease,
	releaseSourceRuntimeLease,
	resetContentRuntimeLoaderForTests,
} from '../src/background/runtime-loader';
import { settingsRepository } from '../src/background/settings-repository';

type Listener = (...args: never[]) => unknown;

class ChromeEvent {
	readonly listeners = new Set<Listener>();
	addListener = (listener: Listener): void => { this.listeners.add(listener); };
	removeListener = (listener: Listener): void => { this.listeners.delete(listener); };
}

interface RuntimeHarness {
	executeCount: number;
	statusCount: number;
	releaseCount: number;
	navigationCommitted: ChromeEvent;
	runtimeMessages: ChromeEvent;
}

const originalGetSnapshot = settingsRepository.getSnapshot;

function installChromeHarness(
	runtimeAlreadyReady = false,
	ownedSources: ContentRuntimeSourceOwnership[] = [],
	releaseFails = false,
	hotkeySettings?: HotkeySettings,
): RuntimeHarness {
	const runtimeMessages = new ChromeEvent();
	const tabRemoved = new ChromeEvent();
	const navigationCommitted = new ChromeEvent();
	const harness = {
		executeCount: 0,
		statusCount: 0,
		releaseCount: 0,
		navigationCommitted,
		runtimeMessages,
	};
	const historyUpdated = new ChromeEvent();
	const fragmentUpdated = new ChromeEvent();
	const documentId = 'document-7';
	if (hotkeySettings) {
		settingsRepository.getSnapshot = async () => ({ hotkeySettings } as never);
	}

	const chromeMock = {
		runtime: {
			id: 'spectra-test',
			onMessage: runtimeMessages,
		},
		webNavigation: {
			getFrame: async () => ({ documentId, url: 'https://media.example/watch' }),
			onCommitted: navigationCommitted,
			onHistoryStateUpdated: historyUpdated,
			onReferenceFragmentUpdated: fragmentUpdated,
		},
		tabs: {
			onRemoved: tabRemoved,
			query: async () => [],
			sendMessage: async (_tabId: number, message: { type: string }) => {
				if (message.type === 'spectra.content.runtime.release') {
					harness.releaseCount += 1;
					if (releaseFails) throw new Error('release response lost');
					return { ok: true, data: { accepted: true } };
				}
				if (message.type !== 'spectra.content.runtime.status') throw new Error('Unexpected tab request');
				harness.statusCount += 1;
				return runtimeAlreadyReady
					? {
						ok: true,
						data: {
							bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
							runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
							ready: true,
							ownedSources,
						},
					}
					: {
						ok: false,
						error: { code: 'content_runtime_not_loaded', message: 'not loaded', retryable: true },
					};
		},
		},
		scripting: {
			executeScript: async () => {
				harness.executeCount += 1;
				queueMicrotask(() => {
					const message = {
						protocolVersion: SPECTRA_PROTOCOL_VERSION,
						requestId: 'runtime-ready-1',
						type: 'spectra.content.runtime.ready',
						payload: { runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION },
						tabId: 7,
						documentId,
					};
					for (const listener of runtimeMessages.listeners) {
						(listener as (
							message: unknown,
							sender: chrome.runtime.MessageSender,
							sendResponse: (response: unknown) => void,
						) => unknown)(message, {
							id: 'spectra-test',
							tab: { id: 7 } as chrome.tabs.Tab,
							documentId,
							url: 'https://media.example/watch',
						}, () => undefined);
					}
				});
			},
		},
	} as unknown as typeof chrome;
	Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeMock });
	initializeContentRuntimeLoader();
	return harness;
}

afterEach(() => {
	resetContentRuntimeLoaderForTests();
	settingsRepository.getSnapshot = originalGetSnapshot;
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('document-scoped content runtime loader', () => {
	test('coalesces concurrent ensure calls into one probe, injection and READY handshake', async () => {
		const harness = installChromeHarness(false);
		const [first, second] = await Promise.all([
			ensureContentRuntime(7, 'document-7', 'control', 'first-control'),
			ensureContentRuntime(7, 'document-7', 'remote', 'remote-session'),
		]);
		expect(first).toEqual(second);
		expect(first).toEqual({
			documentId: 'document-7',
			runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
			ready: true,
		});
		expect(harness.statusCount).toBe(1);
		expect(harness.executeCount).toBe(1);
	});

	test('recovers an already-ready document after a service-worker restart without injection', async () => {
		const harness = installChromeHarness(true);
		const result = await ensureContentRuntime(7, undefined, 'control', 'owned-fields');
		expect(result.ready).toBe(true);
		expect(harness.statusCount).toBe(1);
		expect(harness.executeCount).toBe(0);
	});

	test('recovers source owners before releasing a transient post-restart request', async () => {
		const target = {
			frameId: 0,
			documentId: 'document-7',
			mediaId: 'media-owned',
			sourceRevision: 3,
			kind: 'audio' as const,
		};
		const harness = installChromeHarness(true, [{
			target,
			markerCount: 2,
			abActive: false,
		}]);
		await ensureContentRuntime(7, 'document-7', 'control', 'transient');
		releaseContentRuntimeLease(7, 'document-7', 'control', 'transient');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(0);

		releaseSourceRuntimeLease(7, target, 'marker');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);
	});

	test('keeps a shared runtime until its final independent consumer releases', async () => {
		const harness = installChromeHarness(true);
		await Promise.all([
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
			ensureContentRuntime(7, 'document-7', 'remote', 'remote-a'),
		]);

		releaseContentRuntimeLease(7, 'document-7', 'observation', 'popup-a');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(0);

		releaseContentRuntimeLease(7, 'document-7', 'remote', 'remote-a');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);
	});

	test('treats duplicate acquisition by the same consumer token as idempotent', async () => {
		const harness = installChromeHarness(true);
		await Promise.all([
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
		]);

		releaseContentRuntimeLease(7, 'document-7', 'observation', 'popup-a');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);
	});

	test('cancels a scheduled teardown when a handoff consumer acquires in the grace window', async () => {
		const harness = installChromeHarness(true);
		await ensureContentRuntime(7, 'document-7', 'control', 'request-a');
		releaseContentRuntimeLease(7, 'document-7', 'control', 'request-a');
		await Bun.sleep(25);
		await ensureContentRuntime(7, 'document-7', 'control', 'owned-state');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(0);
	});

	test('invalidates an ambiguous READY cache after a lost release response', async () => {
		const harness = installChromeHarness(true, [], true);
		await ensureContentRuntime(7, 'document-7', 'control', 'request-a');
		releaseContentRuntimeLease(7, 'document-7', 'control', 'request-a');
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);
		expect(harness.statusCount).toBe(1);

		await ensureContentRuntime(7, 'document-7', 'control', 'request-b');
		expect(harness.statusCount).toBe(2);
		expect(harness.executeCount).toBe(0);
	});

	test('holds the heavy runtime only while the current site has an enabled custom hotkey', async () => {
		const harness = installChromeHarness(true);
		const enabled: HotkeySettings = {
			slots: {},
			sites: {
				'media.example': {
					enabled: true,
					bindings: [{
						id: 'play',
						enabled: true,
						key: { code: 'KeyK', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
						action: 'play_pause',
					}],
				},
			},
			disabledLegacyBindings: [],
		};
		await reconcileHotkeyRuntimeLease(
			7,
			'document-7',
			'https://media.example/watch',
			enabled,
		);
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(0);

		await reconcileHotkeyRuntimeLease(
			7,
			'document-7',
			'https://other.example/watch',
			enabled,
		);
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);
	});

	test('acquires a configured hotkey runtime from a new document HELLO without opening Popup', async () => {
		const enabled: HotkeySettings = {
			slots: {},
			sites: {
				'media.example': {
					enabled: true,
					bindings: [{
						id: 'instant-play',
						enabled: true,
						key: { code: 'KeyK', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
						action: 'play_pause',
					}],
				},
			},
			disabledLegacyBindings: [],
		};
		const harness = installChromeHarness(false, [], false, enabled);
		for (const listener of harness.runtimeMessages.listeners) {
			(listener as (
				message: unknown,
				sender: chrome.runtime.MessageSender,
				sendResponse: (response: unknown) => void,
			) => unknown)({
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'bootstrap-hello-1',
				type: 'spectra.content.bootstrap.hello',
				payload: { bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION },
			}, {
				id: 'spectra-test',
				tab: { id: 7, url: 'https://media.example/watch' } as chrome.tabs.Tab,
				documentId: 'document-7',
				// Deliberately omit sender.url: the tab URL is the reliable fallback
				// that makes a fresh document independent from the Popup lifecycle.
			}, () => undefined);
		}
		for (let attempt = 0; attempt < 20 && harness.executeCount === 0; attempt += 1) {
			await Bun.sleep(5);
		}
		expect(harness.executeCount).toBe(1);
	});
});
