import { afterEach, describe, expect, test } from 'bun:test';
import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_HOTKEY_SETTINGS,
	type ContentRuntimeSourceOwnership,
	type HotkeySettings,
} from '@nexus/contracts';
import {
	ensureContentRuntime,
	awaitDocumentInitialization,
	initializeContentRuntimeLoader,
	reconcileHotkeyRuntimeLease,
	releaseContentRuntimeLease,
	releaseSourceRuntimeLease,
	resetContentRuntimeLoaderForTests,
	runtimeLoaderTestApi,
} from '../src/background/runtime-loader';
import { settingsRepository } from '../src/background/settings-repository';
import { storage } from '../src/background/state';

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
	navigationDOMContentLoaded: ChromeEvent;
	runtimeMessages: ChromeEvent;
}

const originalGetSnapshot = settingsRepository.getSnapshot;
const originalResolveAudioConfig = settingsRepository.resolveAudioConfig;
const originalRebindTabSession = storage.tabSession.rebind;

function installChromeHarness(
	runtimeAlreadyReady = false,
	ownedSources: ContentRuntimeSourceOwnership[] = [],
	releaseFails = false,
	hotkeySettings?: HotkeySettings,
	injectionSettles = true,
): RuntimeHarness {
	const runtimeMessages = new ChromeEvent();
	const tabRemoved = new ChromeEvent();
	const navigationCommitted = new ChromeEvent();
	const navigationDOMContentLoaded = new ChromeEvent();
	const harness = {
		executeCount: 0,
		statusCount: 0,
		releaseCount: 0,
		navigationCommitted,
		navigationDOMContentLoaded,
		runtimeMessages,
	};
	const historyUpdated = new ChromeEvent();
	const fragmentUpdated = new ChromeEvent();
	const storageChanged = new ChromeEvent();
	const documentId = 'document-7';
	settingsRepository.getSnapshot = async () => ({
		hotkeySettings: hotkeySettings ?? DEFAULT_HOTKEY_SETTINGS,
	} as never);
	settingsRepository.resolveAudioConfig = async () => ({
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
	});

	const chromeMock = {
		runtime: {
			id: 'spectra-test',
			getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
			onMessage: runtimeMessages,
		},
		storage: {
			local: {
				get: async () => ({}),
				set: async () => undefined,
				remove: async () => undefined,
			},
			session: {
				get: async () => ({}),
				set: async () => undefined,
				remove: async () => undefined,
			},
			onChanged: storageChanged,
		},
		webNavigation: {
			getFrame: async () => ({ documentId, url: 'https://media.example/watch' }),
			onCommitted: navigationCommitted,
			onDOMContentLoaded: navigationDOMContentLoaded,
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
				if (!injectionSettles) await new Promise<never>(() => undefined);
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
	settingsRepository.resolveAudioConfig = originalResolveAudioConfig;
	storage.tabSession.rebind = originalRebindTabSession;
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('document-scoped content runtime loader', () => {
	test('restores an exact-resource tab session before consulting site or global presets', async () => {
		const sessionPatch = {
			volumeBase: 100,
			boost: 2.75,
			mediaMuted: true,
			speed: 1.75,
			rotation: 90 as const,
		};
		const presetConfig = {
			...DEFAULT_AUDIO_CONFIG,
			volume: 140,
			volumeBase: 100,
			boost: 1.4,
		};
		let presetReads = 0;
		storage.tabSession.rebind = async (tabId, identity) => {
			expect(tabId).toBe(7);
			expect(identity).toEqual({
				tabId: 7,
				documentId: 'document-7',
				origin: 'https://media.example',
				resourceUrl: 'https://media.example/watch',
			});
			return sessionPatch;
		};
		settingsRepository.resolveAudioConfig = async () => {
			presetReads += 1;
			return presetConfig;
		};

		expect(await runtimeLoaderTestApi.resolveDocumentRestorePlan(
			7,
			'document-7',
			'https://media.example/watch',
		)).toEqual({ patch: sessionPatch, source: 'session' });
		expect(presetReads).toBe(0);

		storage.tabSession.rebind = async () => null;
		expect(await runtimeLoaderTestApi.resolveDocumentRestorePlan(
			7,
			'document-8',
			'https://other.example/watch',
		)).toEqual({
			source: 'preset',
			patch: {
				volumeBase: 100,
				mediaMuted: false,
				speed: 1,
				preservePitch: true,
				audioEnabled: true,
				boost: 1.4,
				eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				bass: false,
				compressor: false,
				mono: false,
				pan: 0,
				delay: 0,
			},
		});
		expect(presetReads).toBe(1);
	});

	test('treats an acknowledged default-valued session as authoritative over presets', async () => {
		const sessionPatch = {
			volumeBase: 100,
			boost: 1,
			mediaMuted: false,
			speed: 1,
		};
		let presetReads = 0;
		storage.tabSession.rebind = async () => sessionPatch;
		settingsRepository.resolveAudioConfig = async () => {
			presetReads += 1;
			return { ...DEFAULT_AUDIO_CONFIG, speed: 2 };
		};

		expect(await runtimeLoaderTestApi.resolveDocumentRestorePlan(
			7,
			'document-7',
			'https://media.example/watch',
		)).toEqual({ patch: sessionPatch, source: 'session' });
		expect(presetReads).toBe(0);
	});

	test('splits media, video, and processor restores so no stale target is reused', () => {
		expect(runtimeLoaderTestApi.splitDocumentRestorePatch({
			volumeBase: 64,
			speed: 1.5,
			rotation: 90,
			filterEnabled: true,
			boost: 2,
			bass: true,
		})).toEqual([
			{
				requestedCoverage: 'active-target',
				patch: { volumeBase: 64, speed: 1.5 },
			},
			{
				requestedCoverage: 'active-target',
				patch: { rotation: 90, filterEnabled: true },
			},
			{
				requestedCoverage: 'full',
				patch: { boost: 2, bass: true },
			},
		]);
	});

	test('shares one restore barrier between bootstrap and first explicit control', async () => {
		const harness = installChromeHarness(true);
		let restoreCount = 0;
		let releaseRestore!: () => void;
		const restorePending = new Promise<void>((resolve) => { releaseRestore = resolve; });
		runtimeLoaderTestApi.setDocumentRestore(async () => {
			restoreCount += 1;
			await restorePending;
		});

		let helloResponse: unknown;
		let helloReturn: unknown;
		for (const listener of harness.runtimeMessages.listeners) {
			helloReturn = (listener as (
				message: unknown,
				sender: chrome.runtime.MessageSender,
				sendResponse: (response: unknown) => void,
			) => unknown)({
				protocolVersion: SPECTRA_PROTOCOL_VERSION,
				requestId: 'bootstrap-restore-barrier',
				type: 'spectra.content.bootstrap.hello',
				payload: { bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION },
			}, {
				id: 'spectra-test',
				tab: { id: 7, url: 'https://media.example/watch' } as chrome.tabs.Tab,
				documentId: 'document-7',
				url: 'https://media.example/watch',
			}, (response) => { helloResponse = response; });
		}
		expect(helloReturn).toBe(true);
		const firstControl = awaitDocumentInitialization(7, 'document-7');
		const secondControl = awaitDocumentInitialization(7, 'document-7');
		await Promise.resolve();
		expect(restoreCount).toBe(1);
		let settled = false;
		void firstControl.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(helloResponse).toBeUndefined();

		releaseRestore();
		await Promise.all([firstControl, secondControl]);
		await Promise.resolve();
		expect(restoreCount).toBe(1);
		expect(helloResponse).toMatchObject({
			ok: true,
			data: { accepted: true, runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION },
		});
	});

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

	test('accepts READY even while the executeScript promise remains pending', async () => {
		const harness = installChromeHarness(false, [], false, undefined, false);
		const result = await Promise.race([
			ensureContentRuntime(7, 'document-7', 'control', 'slow-injection'),
			Bun.sleep(100).then(() => { throw new Error('READY was held behind executeScript'); }),
		]);
		expect(result.ready).toBe(true);
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

	test('allows tab-hosted extension UI release while rejecting content documents', async () => {
		const harness = installChromeHarness(true);
		const dispatchRelease = (
			sender: chrome.runtime.MessageSender,
			capability: string,
		): unknown => {
			let response: unknown;
			for (const listener of harness.runtimeMessages.listeners) {
				(listener as (
					message: unknown,
					sender: chrome.runtime.MessageSender,
					sendResponse: (response: unknown) => void,
				) => unknown)({
					protocolVersion: SPECTRA_PROTOCOL_VERSION,
					requestId: `release-${capability}`,
					type: 'spectra.content.runtime.release',
					payload: {
						runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
						tabId: 7,
						documentId: 'document-7',
						reason: 'observation',
						capability,
					},
				}, sender, (result) => { response = result; });
			}
			return response;
		};

		await ensureContentRuntime(7, 'document-7', 'observation', 'options-tab');
		expect(dispatchRelease({
			id: 'spectra-test',
			tab: { id: 99 } as chrome.tabs.Tab,
			url: 'chrome-extension://spectra-test/options.html',
		}, 'options-tab')).toMatchObject({ ok: true, data: { accepted: true } });
		await Bun.sleep(300);
		expect(harness.releaseCount).toBe(1);

		await ensureContentRuntime(7, 'document-7', 'observation', 'content-page');
		expect(dispatchRelease({
			id: 'spectra-test',
			tab: { id: 7 } as chrome.tabs.Tab,
			documentId: 'document-7',
			url: 'https://media.example/watch',
		}, 'content-page')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
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

	test('retries a configured hotkey lease at DOMContentLoaded when bootstrap HELLO was missed', async () => {
		const enabled: HotkeySettings = {
			slots: {},
			sites: {
				'media.example': {
					enabled: true,
					bindings: [{
						id: 'cold-volume',
						enabled: true,
						key: { code: 'ArrowUp', modifiers: { ctrl: false, alt: true, shift: false, meta: false } },
						action: 'volume_up',
					}],
				},
			},
			disabledLegacyBindings: [],
		};
		const harness = installChromeHarness(false, [], false, enabled);
		for (const listener of harness.navigationDOMContentLoaded.listeners) {
			(listener as (details: {
				frameId: number;
				tabId: number;
				documentId: string;
				url: string;
			}) => void)({
				frameId: 0,
				tabId: 7,
				documentId: 'document-7',
				url: 'https://media.example/watch',
			});
		}
		for (let attempt = 0; attempt < 20 && harness.executeCount === 0; attempt += 1) {
			await Bun.sleep(5);
		}
		expect(harness.executeCount).toBe(1);
	});
});
