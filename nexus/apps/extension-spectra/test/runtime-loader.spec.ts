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
	currentDocumentId: string;
	getFrameError: Error | null;
	executeCount: number;
	leanExecuteCount: number;
	leanConfigureCount: number;
	heavySettingsConfigureCount: number;
	statusCount: number;
	releaseCount: number;
	navigationCommitted: ChromeEvent;
	navigationDOMContentLoaded: ChromeEvent;
	runtimeMessages: ChromeEvent;
}

async function expectRelease(harness: RuntimeHarness, expected: number, settleWindowMs = 0): Promise<void> {
	if (settleWindowMs > 0) await Bun.sleep(settleWindowMs);
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (harness.releaseCount === expected) break;
		await Bun.sleep(5);
	}
	expect(harness.releaseCount).toBe(expected);
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
		currentDocumentId: 'document-7',
		getFrameError: null,
		executeCount: 0,
		leanExecuteCount: 0,
		leanConfigureCount: 0,
		heavySettingsConfigureCount: 0,
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
	let leanReceiverPresent = false;
	let heavyReceiverPresent = runtimeAlreadyReady;
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
			getFrame: async () => {
				if (harness.getFrameError) throw harness.getFrameError;
				return {
					documentId: harness.currentDocumentId,
					url: 'https://media.example/watch',
				};
			},
			onCommitted: navigationCommitted,
			onDOMContentLoaded: navigationDOMContentLoaded,
			onHistoryStateUpdated: historyUpdated,
			onReferenceFragmentUpdated: fragmentUpdated,
		},
		tabs: {
			onRemoved: tabRemoved,
			query: async () => [],
			sendMessage: async (_tabId: number, message: {
				type: string;
				payload?: { epoch?: string; generation?: number; bindings?: unknown[] };
			}) => {
				if (message.type === 'spectra.content.site-hotkeys.configure') {
					if (!leanReceiverPresent) {
						// The manifest bootstrap is a receiver, but does not claim the
						// lean-host protocol. Real Chrome resolves this as undefined.
						return undefined;
					}
					harness.leanConfigureCount += 1;
					return {
						accepted: true,
						epoch: message.payload?.epoch,
						generation: message.payload?.generation,
					};
				}
				if (message.type === 'spectra.hotkeys.changed') {
					if (!heavyReceiverPresent) {
						throw new Error('Could not establish connection. Receiving end does not exist.');
					}
					harness.heavySettingsConfigureCount += 1;
					return undefined;
				}
				if (message.type === 'spectra.content.runtime.release') {
					harness.releaseCount += 1;
					if (releaseFails) throw new Error('release response lost');
					heavyReceiverPresent = false;
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
			executeScript: async (details: { files?: string[] }) => {
				if (details.files?.includes('content-site-hotkeys.js')) {
					harness.leanExecuteCount += 1;
					leanReceiverPresent = true;
					return;
				}
				harness.executeCount += 1;
				heavyReceiverPresent = true;
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
							frameId: 0,
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
	test('derives immutable runtime identity only from the current top-level Chrome sender', async () => {
		const harness = installChromeHarness(false);
		const dispatch = async (
			sender: Partial<chrome.runtime.MessageSender>,
			payload: Record<string, unknown> = {},
		): Promise<{ response: unknown; listenerResult: unknown }> => {
			let settle: ((value: unknown) => void) | undefined;
			const response = new Promise<unknown>((resolve) => { settle = resolve; });
			let listenerResult: unknown;
			for (const listener of harness.runtimeMessages.listeners) {
				listenerResult = (listener as (
					message: unknown,
					sender: chrome.runtime.MessageSender,
					sendResponse: (value: unknown) => void,
				) => unknown)({
					protocolVersion: SPECTRA_PROTOCOL_VERSION,
					requestId: `runtime-identity-${String(sender.frameId)}`,
					type: 'spectra.content.runtime.identity',
					payload,
				}, {
					id: 'spectra-test',
					tab: { id: 7 } as chrome.tabs.Tab,
					documentId: 'document-7',
					frameId: 0,
					url: 'https://media.example/watch',
					...sender,
				}, (value) => { settle?.(value); });
			}
			return { response: await response, listenerResult };
		};

		const accepted = await dispatch({});
		expect(accepted.listenerResult).toBe(true);
		expect(accepted.response).toEqual({
			ok: true,
			data: { documentId: 'document-7', frameId: 0 },
		});
		expect((await dispatch({ frameId: 1 })).response).toMatchObject({
			ok: false,
			error: { code: 'forbidden' },
		});
		expect((await dispatch({ frameId: undefined })).response).toMatchObject({
			ok: false,
			error: { code: 'forbidden' },
		});
		expect((await dispatch({ id: undefined })).response).toMatchObject({
			ok: false,
			error: { code: 'forbidden' },
		});
		expect((await dispatch({ id: 'foreign-extension' })).response).toMatchObject({
			ok: false,
			error: { code: 'forbidden' },
		});
		expect((await dispatch({ documentId: '   ' })).response).toMatchObject({
			ok: false,
			error: { code: 'forbidden' },
		});

		harness.currentDocumentId = 'document-8';
		expect((await dispatch({})).response).toMatchObject({
			ok: false,
			error: { code: 'stale_document' },
		});
		harness.currentDocumentId = 'document-7';
		harness.getFrameError = new Error('frame lookup unavailable');
		expect((await dispatch({})).response).toMatchObject({
			ok: false,
			error: { code: 'runtime_identity_unavailable', retryable: true },
		});
		harness.getFrameError = null;
		expect((await dispatch({}, { surplus: true })).response).toMatchObject({
			ok: false,
			error: { code: 'invalid_request' },
		});
	});

	test('limits bulk hotkey projection to content-script URL schemes', () => {
		expect(runtimeLoaderTestApi.isContentDocumentUrl('https://media.example/watch')).toBe(true);
		expect(runtimeLoaderTestApi.isContentDocumentUrl('http://localhost:3000/')).toBe(true);
		expect(runtimeLoaderTestApi.isContentDocumentUrl('file:///D:/media/demo.html')).toBe(true);
		expect(runtimeLoaderTestApi.isContentDocumentUrl('chrome-extension://spectra/options.html')).toBe(false);
		expect(runtimeLoaderTestApi.isContentDocumentUrl('about:blank')).toBe(false);
		expect(runtimeLoaderTestApi.isContentDocumentUrl('not a url')).toBe(false);
	});
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
				frameId: 0,
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
		await expectRelease(harness, 0, 50);

		releaseSourceRuntimeLease(7, target, 'marker');
		await expectRelease(harness, 1);
	});

	test('keeps a shared runtime until its final independent consumer releases', async () => {
		const harness = installChromeHarness(true);
		await Promise.all([
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
			ensureContentRuntime(7, 'document-7', 'remote', 'remote-a'),
		]);

		releaseContentRuntimeLease(7, 'document-7', 'observation', 'popup-a');
		await expectRelease(harness, 0, 50);

		releaseContentRuntimeLease(7, 'document-7', 'remote', 'remote-a');
		await expectRelease(harness, 1);
	});

	test('treats duplicate acquisition by the same consumer token as idempotent', async () => {
		const harness = installChromeHarness(true);
		await Promise.all([
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
			ensureContentRuntime(7, 'document-7', 'observation', 'popup-a'),
		]);

		releaseContentRuntimeLease(7, 'document-7', 'observation', 'popup-a');
		await expectRelease(harness, 1);
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
		await expectRelease(harness, 1);

		await ensureContentRuntime(7, 'document-7', 'observation', 'content-page');
		expect(dispatchRelease({
			id: 'spectra-test',
			tab: { id: 7 } as chrome.tabs.Tab,
			documentId: 'document-7',
			url: 'https://media.example/watch',
		}, 'content-page')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
		await expectRelease(harness, 1);
	});

	test('cancels a scheduled teardown when a handoff consumer acquires in the grace window', async () => {
		const harness = installChromeHarness(true);
		await ensureContentRuntime(7, 'document-7', 'control', 'request-a');
		releaseContentRuntimeLease(7, 'document-7', 'control', 'request-a');
		await Bun.sleep(25);
		await ensureContentRuntime(7, 'document-7', 'control', 'owned-state');
		await expectRelease(harness, 0, 50);
	});

	test('invalidates an ambiguous READY cache after a lost release response', async () => {
		const harness = installChromeHarness(true, [], true);
		await ensureContentRuntime(7, 'document-7', 'control', 'request-a');
		releaseContentRuntimeLease(7, 'document-7', 'control', 'request-a');
		await expectRelease(harness, 1);
		expect(harness.statusCount).toBe(1);

		await ensureContentRuntime(7, 'document-7', 'control', 'request-b');
		expect(harness.statusCount).toBe(2);
		expect(harness.executeCount).toBe(0);
	});

	test('keeps complex configured sites on the heavy runtime and releases when site ownership disappears', async () => {
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
		await reconcileHotkeyRuntimeLease(7, 'document-7', 'https://media.example/watch', enabled);
		expect(harness.leanExecuteCount).toBe(0);
		expect(harness.heavySettingsConfigureCount).toBe(1);
		await expectRelease(harness, 0, 50);

		await reconcileHotkeyRuntimeLease(7, 'document-7', 'https://other.example/watch', enabled);
		expect(harness.heavySettingsConfigureCount).toBe(2);
		await expectRelease(harness, 1);
	});

	test('keeps scalar configured sites lean without acquiring the heavy runtime', async () => {
		const harness = installChromeHarness(false);
		const enabled: HotkeySettings = {
			slots: {},
			sites: {
				'media.example': {
					enabled: true,
					bindings: [{
						id: 'lean-volume',
						enabled: true,
						key: { code: 'KeyU', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
						action: 'volume_up',
					}],
				},
			},
			disabledLegacyBindings: [],
		};
		await reconcileHotkeyRuntimeLease(7, 'document-7', 'https://media.example/watch', enabled);
		expect(harness.leanExecuteCount).toBe(1);
		expect(harness.leanConfigureCount).toBe(1);
		expect(harness.heavySettingsConfigureCount).toBe(0);
		expect(harness.executeCount).toBe(0);
		expect(harness.statusCount).toBe(0);
		await expectRelease(harness, 0, 50);
	});

	test('acquires a complex configured hotkey runtime from a new document HELLO without opening Popup', async () => {
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
				frameId: 0,
			}, () => undefined);
		}
		for (let attempt = 0; attempt < 20 && harness.executeCount === 0; attempt += 1) {
			await Bun.sleep(5);
		}
		expect(harness.executeCount).toBe(1);
		expect(harness.leanExecuteCount).toBe(0);
	});

	test('retries a lean configured hotkey host at DOMContentLoaded when bootstrap HELLO was missed', async () => {
		const enabled: HotkeySettings = {
			slots: {},
			sites: {
				'media.example': {
					enabled: true,
					bindings: [{
						id: 'cold-volume',
						enabled: true,
						key: { code: 'KeyU', modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
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
		for (let attempt = 0; attempt < 20 && harness.leanExecuteCount === 0; attempt += 1) {
			await Bun.sleep(5);
		}
		expect(harness.leanExecuteCount).toBe(1);
		expect(harness.executeCount).toBe(0);
	});
});
