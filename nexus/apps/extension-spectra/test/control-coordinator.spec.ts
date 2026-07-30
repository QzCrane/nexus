import { afterEach, describe, expect, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import type {
	ControlApplyAck,
	ControlField,
	ControlFieldStates,
	ControlIntent,
	ControlOperationAck,
	ControlOperationIntent,
	ControlReadRequest,
	ControlStrategy,
	ControlSubmitRequest,
} from '@nexus/contracts';
import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
} from '@nexus/contracts';
import {
	controlCoordinatorTestApi,
	type ExtensionInvocationContext,
} from '../src/background/control-coordinator';
import { resetBadgeUsageForTests } from '../src/background/badge-usage';
import { badgeState } from '../src/background/state';

interface Harness {
	documentId: string;
	url: string;
	activeTabId: number;
	storage: Map<string, unknown>;
	storageWrites: number;
	resolveContent?: (response: unknown) => void;
	contentIntent?: ControlIntent;
	contentMessages: Array<{ type: string; payload: unknown }>;
	contentResponder?: (message: { type: string; payload: unknown }) => unknown | Promise<unknown>;
	snapshotEvents: number;
	mainExecutions: number;
	mainResult: { ok: boolean; before?: unknown; actual?: unknown; error?: string };
	popupWindowIds: number[];
	createdTabs: chrome.tabs.CreateProperties[];
}

function appliedSpeedAck(intent: ControlIntent): ControlApplyAck {
	return {
		intentId: intent.intentId,
		tabId: intent.tabId,
		documentId: intent.documentId,
		generation: intent.generation,
		revision: intent.baseRevision + 1,
		target: intent.target,
		fields: {
			speed: {
				desired: intent.patch.speed ?? null,
				actual: intent.patch.speed ?? null,
				revision: intent.baseRevision + 1,
				phase: 'applied',
				strategy: 'dom-native',
				coverage: 'active-target',
				controlled: true,
				intentId: intent.intentId,
				lastError: null,
			},
		},
	};
}

function installHarness(): Harness {
	const harness: Harness = {
		documentId: 'document-1',
		url: 'https://media.example/one',
		activeTabId: 7,
		storage: new Map(),
		storageWrites: 0,
		contentMessages: [],
		snapshotEvents: 0,
		mainExecutions: 0,
		mainResult: { ok: true, before: 1, actual: 1.5 },
		popupWindowIds: [],
		createdTabs: [],
	};
	let pinned = false;
	let muted = false;
	const chromeMock = {
		action: {
			openPopup: async ({ windowId }: { windowId: number }) => {
				harness.popupWindowIds.push(windowId);
			},
		},
		runtime: {
			id: 'spectra-test',
			getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
			openOptionsPage: async () => undefined,
			sendMessage: async (message: { type?: unknown }) => {
				if (message.type === 'spectra.control.snapshot.changed') harness.snapshotEvents += 1;
				return undefined;
			},
		},
		webNavigation: {
			getFrame: async () => ({ documentId: harness.documentId, url: harness.url }),
		},
		scripting: {
			executeScript: async () => {
				harness.mainExecutions += 1;
				return [{ documentId: harness.documentId, result: harness.mainResult }];
			},
		},
		storage: {
			session: {
				get: async (keys: string | string[]) => {
					const result: Record<string, unknown> = {};
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						if (harness.storage.has(key)) result[key] = harness.storage.get(key);
					}
					return result;
				},
				set: async (values: Record<string, unknown>) => {
					harness.storageWrites += 1;
					for (const [key, value] of Object.entries(values)) harness.storage.set(key, value);
				},
				remove: async (keys: string | string[]) => {
					for (const key of Array.isArray(keys) ? keys : [keys]) harness.storage.delete(key);
				},
			},
		},
		tabs: {
			query: async () => [{ id: harness.activeTabId, active: true }],
			create: async (properties: chrome.tabs.CreateProperties) => {
				harness.createdTabs.push(properties);
				return { id: 8, ...properties };
			},
			update: async (_tabId: number, changes: { pinned?: boolean; muted?: boolean }) => {
				if (changes.pinned !== undefined) pinned = changes.pinned;
				if (changes.muted !== undefined) muted = changes.muted;
				return { pinned, mutedInfo: { muted } };
			},
			get: async () => ({ id: 7, windowId: 3, index: 4, pinned, mutedInfo: { muted } }),
			sendMessage: async (_tabId: number, message: { type: string; payload: unknown }) => {
				harness.contentMessages.push(message);
				if (message.type === 'spectra.content.runtime.status') {
					return {
						ok: true,
						data: {
							bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
							runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
							ready: true,
							ownedSources: [],
						},
					};
				}
				if (harness.contentResponder) return harness.contentResponder(message);
				harness.contentIntent = message.payload as ControlIntent;
				return new Promise((resolve) => { harness.resolveContent = resolve; });
			},
		},
	} as unknown as typeof chrome;
	Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeMock });
	return harness;
}

function appliedFields(
	intent: ControlIntent,
	strategy: (field: ControlField) => ControlStrategy,
): ControlFieldStates {
	const fields: ControlFieldStates = {};
	for (const [rawField, actual] of Object.entries(intent.patch)) {
		const field = rawField as ControlField;
		const selected = strategy(field);
		(fields as Record<string, unknown>)[field] = {
			desired: actual,
			actual,
			revision: intent.baseRevision + 1,
			phase: 'applied',
			strategy: selected,
			coverage: intent.requestedCoverage,
			controlled: selected !== 'observe',
			intentId: intent.intentId,
			lastError: null,
		};
	}
	return fields;
}

function appliedPatchAck(
	intent: ControlIntent,
	strategy: (field: ControlField) => ControlStrategy,
): ControlApplyAck {
	return {
		intentId: intent.intentId,
		tabId: intent.tabId,
		documentId: intent.documentId,
		generation: intent.generation,
		revision: intent.baseRevision + 1,
		target: intent.target,
		fields: appliedFields(intent, strategy),
	};
}

function releasedPatchAck(intent: ControlIntent): ControlApplyAck {
	const acknowledgement = appliedPatchAck(intent, (field) => (
		field === 'audioEnabled' ? 'extension-state' : 'observe'
	));
	for (const [field, state] of Object.entries(acknowledgement.fields)) {
		if (!state || field === 'audioEnabled') continue;
		state.phase = 'idle';
		state.controlled = false;
	}
	return acknowledgement;
}

function actualReadAck(payload: ControlReadRequest, target: ControlApplyAck['target']): unknown {
	const defaults: Record<ControlField, unknown> = {
		audioEnabled: false,
		volumeBase: 72,
		boost: 1,
		mediaMuted: false,
		tabMuted: false,
		speed: 1,
		preservePitch: true,
		playing: false,
		currentTime: 0,
		loop: false,
		pip: false,
		fullscreen: false,
		rotation: 0,
		mirrored: false,
		fill: false,
		filterEnabled: false,
		filter: { brightness: 100, contrast: 100, saturate: 100, grayscale: false, invert: false },
		dimEnabled: false,
		dimOpacity: 0.72,
		abLoop: { pointA: null, pointB: null, enabled: false },
		tabPinned: false,
		eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		bass: false,
		compressor: false,
		mono: false,
		pan: 0,
		delay: 0,
		visualizer: false,
	};
	return {
		ok: true,
		data: {
			target,
			patch: Object.fromEntries(payload.fields.map((field) => [field, defaults[field]])),
			observedStrategies: Object.fromEntries(payload.fields
				.filter((field) => new Set<ControlField>([
					'volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'playing',
					'currentTime', 'loop', 'pip', 'fullscreen',
				]).has(field))
				.map((field) => [field, 'dom-native'])),
		},
	};
}

function request(patch: ControlSubmitRequest['patch']): ControlSubmitRequest {
	return { tabId: 7, source: 'popup', requestedCoverage: 'active-target', target: null, patch };
}

function invocation(
	harness: Harness,
	origin: ExtensionInvocationContext['origin'] = 'popup',
	foregroundTabId: number | null = 7,
): ExtensionInvocationContext {
	const target = { tabId: 7, documentId: harness.documentId };
	return {
		origin,
		foreground: foregroundTabId === null
			? null
			: {
				tabId: foregroundTabId,
				documentId: foregroundTabId === target.tabId
					? target.documentId
					: 'document-foreground',
			},
		target,
	};
}

function speedErrorAck(intent: ControlIntent, code: string): ControlApplyAck {
	return {
		...appliedSpeedAck(intent),
		fields: {
			speed: {
				desired: intent.patch.speed ?? null,
				actual: null,
				revision: intent.baseRevision + 1,
				phase: 'error',
				strategy: 'unsupported',
				coverage: 'partial',
				controlled: false,
				intentId: intent.intentId,
				lastError: { code, message: 'DOM write failed', retryable: true },
			},
		},
	};
}

afterEach(async () => {
	await controlCoordinatorTestApi.reset();
	badgeState.clear();
	resetBadgeUsageForTests();
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('authoritative control coordinator', () => {
	test('mints volatile Capture admission only for an invoked current-tab UI or validated shortcut', async () => {
		const harness = installHarness();
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			expect(type).toBe('spectra.control.intent.execute');
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: appliedPatchAck(intent, () => 'media-webaudio'),
			};
		};
		const fullRequest = (source: 'popup' | 'hotkey' | 'remote' | 'restore', boost: number) => ({
			tabId: 7,
			source,
			requestedCoverage: 'full' as const,
			target: null,
			patch: { boost },
		});

		await controlCoordinatorTestApi.submitInvoked(
			fullRequest('popup', 2),
			invocation(harness, 'popup'),
		);
		await controlCoordinatorTestApi.submitInvoked(
			fullRequest('hotkey', 3),
			invocation(harness, 'site-page'),
		);
		await controlCoordinatorTestApi.submit({
			...fullRequest('hotkey', 4),
			captureAdmission: 'extension-invocation',
		});
		await controlCoordinatorTestApi.submit(fullRequest('remote', 5));
		await controlCoordinatorTestApi.submit(fullRequest('restore', 6));
		const alternateTarget = invocation(harness, 'chrome-command', 8);
		harness.activeTabId = 7;
		await controlCoordinatorTestApi.submitInvoked(
			fullRequest('hotkey', 7),
			alternateTarget,
		);

		expect(intents.map(({ captureAdmission }) => captureAdmission)).toEqual([
			'extension-invocation',
			'extension-invocation',
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});

	test('recognizes only the extension Popup document as a Popup invocation sender', () => {
		installHarness();
		expect(controlCoordinatorTestApi.isExtensionPopupSender({
			id: 'spectra-test',
			url: 'chrome-extension://spectra-test/popup.html',
		})).toBe(true);
		expect(controlCoordinatorTestApi.isExtensionPopupSender({
			id: 'spectra-test',
			url: 'chrome-extension://spectra-test/options.html',
		})).toBe(false);
		expect(controlCoordinatorTestApi.isExtensionPopupSender({
			id: 'spectra-test',
			url: 'https://media.example/one',
			tab: { id: 7 } as chrome.tabs.Tab,
		})).toBe(false);
	});

	test('binds page-hotkey invocation to the exact top-level extension document sender', () => {
		installHarness();
		const sender = {
			id: 'spectra-test',
			url: 'https://media.example/one',
			tab: { id: 7 } as chrome.tabs.Tab,
			frameId: 0,
			documentId: 'document:hotkey',
		};
		expect(controlCoordinatorTestApi.trustedContentHotkeyInvocation(sender, 7)).toEqual({
			origin: 'site-page',
			foreground: { tabId: 7, documentId: 'document:hotkey' },
			target: { tabId: 7, documentId: 'document:hotkey' },
		});
		expect(controlCoordinatorTestApi.trustedContentHotkeyInvocation({
			...sender,
			frameId: 1,
		}, 7)).toBeUndefined();
		expect(controlCoordinatorTestApi.trustedContentHotkeyInvocation({
			...sender,
			url: 'chrome-extension://spectra-test/options.html',
		}, 7)).toBeUndefined();
		expect(controlCoordinatorTestApi.trustedContentHotkeyInvocation({
			...sender,
			tab: { id: 8 } as chrome.tabs.Tab,
		}, 7)).toBeUndefined();
	});

	test('carries the same admission through an invoked effective-volume transaction only', async () => {
		const harness = installHarness();
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, null);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: appliedPatchAck(intent, () => (
					intent.requestedCoverage === 'full' ? 'media-webaudio' : 'dom-native'
				)),
			};
		};

		await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target: null,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 150 },
		}, invocation(harness, 'popup'));
		expect(intents).toHaveLength(2);
		expect(intents.every(({ captureAdmission }) => (
			captureAdmission === 'extension-invocation'
		))).toBe(true);

		intents.length = 0;
		const alternateTarget = invocation(harness, 'chrome-command', 8);
		harness.activeTabId = 7;
		await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'hotkey',
			target: null,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 200 },
		}, alternateTarget);
		expect(intents).toHaveLength(1);
		expect(intents[0]?.captureAdmission).toBeUndefined();
	});

	test('binds browser UI and URL operations to the source tab window', async () => {
		const harness = installHarness();
		const popup = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'hotkey',
			target: null,
			operation: 'open-popup',
			payload: {},
		});
		expect(popup.result).toEqual({ opened: true });
		expect(harness.popupWindowIds).toEqual([3]);

		const url = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'hotkey',
			target: null,
			operation: 'open-url',
			payload: { url: 'https://docs.example/path' },
		});
		expect(url.result).toEqual({ opened: true });
		expect(harness.createdTabs).toEqual([{
			url: 'https://docs.example/path',
			windowId: 3,
			index: 5,
			openerTabId: 7,
			active: true,
		}]);
	});

	test('keeps reads side-effect free and persists monotonic generations across navigation/restart', async () => {
		const harness = installHarness();
		const first = await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		expect(first.generation).toBe(0);
		const writesAfterCommit = harness.storageWrites;
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.tabPinned?.actual).toBe(true);
		expect(harness.storageWrites).toBe(writesAfterCommit);

		harness.documentId = 'document-2';
		harness.url = 'https://media.example/two';
		await controlCoordinatorTestApi.invalidateNavigation(7);
		const second = await controlCoordinatorTestApi.submit(request({ tabPinned: false }));
		expect(second.generation).toBe(1);

		await controlCoordinatorTestApi.reset();
		const afterRestart = await controlCoordinatorTestApi.submit(request({ tabMuted: true }));
		expect(afterRestart.generation).toBe(1);

		harness.documentId = 'document-3';
		harness.url = 'https://media.example/three';
		await controlCoordinatorTestApi.invalidateNavigation(7);
		const third = await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		expect(third.generation).toBe(2);
	});

	test('rejects a late content ACK after navigation instead of committing stale actual state', async () => {
		const harness = installHarness();
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.5 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		const staleIntent = harness.contentIntent;

		harness.documentId = 'document-2';
		harness.url = 'https://media.example/two';
		await controlCoordinatorTestApi.invalidateNavigation(7);
		harness.resolveContent({ ok: true, data: appliedSpeedAck(staleIntent) });

		await expect(pending).rejects.toThrow('after the document or revision changed');
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('rejects a queued shortcut when its frozen target document navigates before execution', async () => {
		const harness = installHarness();
		const blocker = controlCoordinatorTestApi.submit({
			...request({ speed: 1.25 }),
			source: 'system',
		});
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		const blockedIntent = harness.contentIntent;
		const queued = controlCoordinatorTestApi.submitInvoked({
			...request({ speed: 1.5 }),
			source: 'hotkey',
		}, invocation(harness, 'site-page'));
		const blockerResult = blocker.catch((error: unknown) => error);
		const queuedResult = queued.catch((error: unknown) => error);
		await Promise.resolve();

		harness.documentId = 'document-2';
		harness.resolveContent({ ok: true, data: appliedSpeedAck(blockedIntent) });
		const [blockerError, queuedError] = await Promise.all([blockerResult, queuedResult]);
		expect(String(blockerError)).toContain('after the document or revision changed');
		expect(String(queuedError)).toContain('stale target document');
		expect(harness.contentMessages.filter(({ type }) => (
			type === 'spectra.control.intent.execute'
		))).toHaveLength(1);
	});

	test('increments same-document generation without discarding stable controlled state', async () => {
		const harness = installHarness();
		const first = await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		await controlCoordinatorTestApi.invalidateNavigation(7, true);
		const projected = await controlCoordinatorTestApi.getSnapshot(7);
		expect(projected).toMatchObject({
			documentId: first.documentId,
			generation: first.generation + 1,
			revision: first.revision + 1,
		});
		expect(projected?.fields.tabPinned).toMatchObject({
			actual: true,
			phase: 'applied',
		});
		expect(harness.snapshotEvents).toBe(2);
	});

	test('commits a native page observation without echoing a second DOM write', async () => {
		const harness = installHarness();
		const ack = await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target: {
				frameId: 0,
				documentId: 'document-1',
				mediaId: 'media:1',
				sourceRevision: 0,
				kind: 'video',
			},
			patch: { volumeBase: 40, mediaMuted: false },
			observedStrategies: { volumeBase: 'page-native', mediaMuted: 'page-native' },
		});

		expect(harness.contentIntent).toBeUndefined();
		expect(ack.fields.volumeBase).toMatchObject({
			desired: 40,
			actual: 40,
			strategy: 'page-native',
			controlled: false,
		});
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.mediaMuted?.actual).toBe(false);
		expect(harness.storage.get('tab_session_7')).toMatchObject({
			patch: { volumeBase: 40, mediaMuted: false },
			portablePatch: {},
		});
	});

	test('binds a targetless bootstrap observation to its sending document', async () => {
		const harness = installHarness();
		const ack = await controlCoordinatorTestApi.submit({
			tabId: 7,
			observationDocumentId: harness.documentId,
			source: 'page',
			requestedCoverage: 'active-target',
			target: null,
			patch: {
				volumeBase: 64,
				mediaMuted: false,
				speed: 1.5,
				preservePitch: false,
			},
			observedStrategies: {
				volumeBase: 'dom-native',
				mediaMuted: 'dom-native',
				speed: 'dom-native',
				preservePitch: 'dom-native',
			},
		});

		expect(harness.contentIntent).toBeUndefined();
		expect(ack.target).toBeNull();
		expect(ack.fields.speed).toMatchObject({ actual: 1.5, controlled: false });
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.activeMedia).toBeNull();

		await expect(controlCoordinatorTestApi.submit({
			tabId: 7,
			observationDocumentId: 'document-stale',
			source: 'page',
			requestedCoverage: 'active-target',
			target: null,
			patch: { volumeBase: 50, mediaMuted: false },
			observedStrategies: { volumeBase: 'dom-native', mediaMuted: 'dom-native' },
		})).rejects.toThrow('stale document');
	});

	test('absorbs reflected Chrome tab writes and publishes genuine browser-side changes', async () => {
		const harness = installHarness();
		const applied = await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		expect(applied.revision).toBe(1);
		const reflected = await controlCoordinatorTestApi.observeChromeTabState(7, { tabPinned: true });
		expect(reflected.revision).toBe(1);
		expect(harness.snapshotEvents).toBe(1);

		const browserChanged = await controlCoordinatorTestApi.observeChromeTabState(7, {
			tabPinned: false,
			tabMuted: true,
		});
		expect(browserChanged.revision).toBe(2);
		expect(browserChanged.fields.tabPinned).toMatchObject({
			actual: false,
			strategy: 'chrome-native',
			controlled: false,
		});
		expect(browserChanged.fields.tabMuted?.actual).toBe(true);
		expect(harness.snapshotEvents).toBe(2);
	});

	test('normalizes hidden Boost when the page owns a new effective volume', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:boost',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const routed: ControlIntent[] = [];
		harness.contentResponder = ({ payload }) => {
			const intent = payload as ControlIntent;
			routed.push(intent);
			return {
				ok: true,
				data: appliedPatchAck(intent, () => 'media-webaudio'),
			};
		};
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 2 },
		});

		const ack = await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 55 },
			observedStrategies: { volumeBase: 'page-native' },
		});

		expect(routed).toHaveLength(2);
		expect(routed[1]).toMatchObject({
			source: 'system',
			requestedCoverage: 'full',
			patch: { boost: 1 },
		});
		expect(ack.revision).toBe(2);
		expect(ack.fields.volumeBase?.actual).toBe(55);
		expect(ack.fields.boost?.actual).toBe(1);
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.boost?.actual).toBe(1);
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.revision).toBe(2);
		expect(harness.snapshotEvents).toBe(2);
	});

	test('releases Boost before returning an effective volume at or below 100 to the native writer', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:effective-downshift',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: intent.requestedCoverage === 'full' && intent.patch.boost === 1
					? releasedPatchAck(intent)
					: appliedPatchAck(intent, (field) => field === 'boost' ? 'media-webaudio' : 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 100 },
		});
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 2 },
		});
		intents.length = 0;

		const acknowledgement = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 80 },
		});

		expect(intents.map((intent) => intent.patch)).toEqual([
			{ boost: 1 },
			{ volumeBase: 80 },
		]);
		expect(acknowledgement.result).toEqual({
			effectiveVolume: 80,
			volumeBase: 80,
			boost: 1,
		});
	});

	test('persists the complete effective-volume pair when only Boost needs a writer', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:effective-persistence',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				const acknowledgement = actualReadAck(
					payload as ControlReadRequest,
					target,
				) as { ok: true; data: { patch: Record<string, unknown> } };
				acknowledgement.data.patch.volumeBase = 100;
				acknowledgement.data.patch.boost = 1;
				return acknowledgement;
			}
			const intent = payload as ControlIntent;
			return {
				ok: true,
				data: appliedPatchAck(intent, () => 'media-webaudio'),
			};
		};

		const acknowledgement = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 110 },
		});
		expect(acknowledgement.result).toEqual({
			effectiveVolume: 110,
			volumeBase: 100,
			boost: 1.1,
		});

		await controlCoordinatorTestApi.reset();
		expect(harness.storage.get('tab_session_7')).toMatchObject({
			version: 3,
			identity: { resourceUrl: 'https://media.example/one' },
			patch: { volumeBase: 100, boost: 1.1 },
			portablePatch: { volumeBase: 100, boost: 1.1 },
		});
	});

	test('establishes a cold Boost owner so the next mute ACK keeps complete volume feedback', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:cold-volume-mute',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			return {
				ok: true,
				data: intent.patch.boost === 1
					? releasedPatchAck(intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		const volumeAck = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'hotkey',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 90 },
		});
		expect(volumeAck.audioVolume).toEqual({
			effectiveVolume: 90,
			volumeState: 'native',
		});
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.boost).toMatchObject({
			actual: 1,
			phase: 'idle',
			strategy: 'observe',
			controlled: false,
		});

		const muteAck = await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'hotkey',
			requestedCoverage: 'active-target',
			target,
			mutations: [{ field: 'mediaMuted', operation: 'toggle' }],
		});
		expect(muteAck.audioVolume).toEqual({
			effectiveVolume: 90,
			volumeState: 'silent',
		});
	});

	test('reprojects sticky acknowledged volume after Chrome clears the badge on navigation', async () => {
		const harness = installHarness();
		let badgeText = '';
		Object.assign(chrome.action, {
			getBadgeText: async () => badgeText,
			setBadgeText: async ({ text }: { text: string }) => { badgeText = text; },
			setBadgeBackgroundColor: async () => undefined,
			setBadgeTextColor: async () => undefined,
		});
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, null);
			}
			if (type !== 'spectra.control.intent.execute') throw new Error(`Unexpected ${type}`);
			const intent = payload as ControlIntent;
			return {
				ok: true,
				data: appliedPatchAck(intent, (field) => field === 'boost' ? 'media-webaudio' : 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submit(request({ volumeBase: 63 }));
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			patch: { boost: 1 },
		});
		expect(badgeText).toBe('63');

		badgeText = '';
		await controlCoordinatorTestApi.reprojectBadgeForCurrentDocument(7);
		expect(badgeText).toBe('63');
	});

	test.each([
		['speed', { speed: 1.1 }, '42'],
		['mute', { mediaMuted: true }, 'M'],
	] as const)(
		'treats the first acknowledged %s shortcut as plugin use and projects the existing volume',
		async (_action, patch, expectedBadge) => {
			const harness = installHarness();
			let badgeText = '';
			Object.assign(chrome.action, {
				setBadgeText: async ({ text }: { text: string }) => { badgeText = text; },
				setBadgeBackgroundColor: async () => undefined,
				setBadgeTextColor: async () => undefined,
			});
			harness.contentResponder = ({ type, payload }) => {
				if (type === 'spectra.control.actual.read') {
					return actualReadAck(payload as ControlReadRequest, null);
				}
				const intent = payload as ControlIntent;
				return {
					ok: true,
					data: appliedPatchAck(
						intent,
						(field) => field === 'boost' ? 'media-webaudio' : 'dom-native',
					),
				};
			};
			await controlCoordinatorTestApi.submit({
				tabId: 7,
				source: 'restore',
				requestedCoverage: 'full',
				target: null,
				patch: { volumeBase: 42, boost: 1, mediaMuted: false },
			});
			expect(badgeText).toBe('');

			await controlCoordinatorTestApi.submitInvoked({
				...request(patch),
				source: 'hotkey',
			}, invocation(harness, 'site-page'));
			expect(badgeText).toBe(expectedBadge);
		},
	);

	test('keeps a first shortcut effective but hides its badge until audio projection is complete', async () => {
		const harness = installHarness();
		let badgeText = '';
		Object.assign(chrome.action, {
			setBadgeText: async ({ text }: { text: string }) => { badgeText = text; },
			setBadgeBackgroundColor: async () => undefined,
			setBadgeTextColor: async () => undefined,
		});
		harness.contentResponder = ({ payload }) => {
			const intent = payload as ControlIntent;
			return { ok: true, data: appliedSpeedAck(intent) };
		};

		await controlCoordinatorTestApi.submitInvoked({
			...request({ speed: 1.1 }),
			source: 'hotkey',
		}, invocation(harness, 'site-page'));
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.speed?.actual).toBe(1.1);
		expect(badgeText).toBe('');
	});

	test('turns an acknowledged repeated effective volume into zero Content IPC and zero storage writes', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:effective-noop',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			return actualReadAck(payload as ControlReadRequest, target);
		};
		await controlCoordinatorTestApi.targetChanged(7, target);
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.intent.execute') throw new Error(`Unexpected ${type}`);
			return { ok: true, data: releasedPatchAck(payload as ControlIntent) };
		};
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'system',
			requestedCoverage: 'full',
			target,
			patch: { boost: 1 },
		});
		harness.contentMessages.length = 0;
		const writes = harness.storageWrites;
		const events = harness.snapshotEvents;

		const ack = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'system',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 72 },
		});

		expect(ack.result).toEqual({ effectiveVolume: 72, volumeBase: 72, boost: 1 });
		expect(ack.fields).toEqual({});
		expect(harness.contentMessages).toHaveLength(0);
		expect(harness.storageWrites).toBe(writes);
		expect(harness.snapshotEvents).toBe(events);
	});

	test('never invokes MAIN after a successful DOM readback', async () => {
		const harness = installHarness();
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.5 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		harness.resolveContent({ ok: true, data: appliedSpeedAck(harness.contentIntent) });

		const ack = await pending;
		expect(ack.fields.speed).toMatchObject({ strategy: 'dom-native', actual: 1.5 });
		expect(harness.mainExecutions).toBe(0);
	});

	test('commits the media target resolved by content instead of echoing a null request target', async () => {
		const harness = installHarness();
		const actualTarget = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:actual',
			sourceRevision: 4,
			kind: 'video' as const,
		};
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.25 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		harness.resolveContent({
			ok: true,
			data: { ...appliedSpeedAck(harness.contentIntent), target: actualTarget },
		});

		const ack = await pending;
		expect(ack.target).toEqual(actualTarget);
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.activeMedia).toEqual(actualTarget);
	});

	test('commits an explicit active-target change with fresh native readback and no page write', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:selected',
			sourceRevision: 2,
			kind: 'video' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			return actualReadAck(payload as ControlReadRequest, target);
		};

		await controlCoordinatorTestApi.targetChanged(7, target);
		let snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(target);
		expect(snapshot?.activeVideo).toEqual(target);
		expect(snapshot?.fields.volumeBase).toMatchObject({
			actual: 72,
			controlled: false,
			strategy: 'dom-native',
		});
		expect((harness.storage.get('tab_session_7') as {
			portablePatch?: Record<string, unknown>;
		} | undefined)?.portablePatch).toEqual({});
		const popupAck = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'hotkey',
			target: null,
			operation: 'open-popup',
			payload: {},
		});
		expect(popupAck.target).toBeNull();

		const audioTarget = { ...target, mediaId: 'media:audio', kind: 'audio' as const };
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target: audioTarget,
			patch: { speed: 1.1 },
			observedStrategies: { speed: 'dom-native' },
		});
		snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(audioTarget);
		expect(snapshot?.activeVideo).toEqual(target);
		expect(harness.contentMessages.map(({ type }) => type)).toEqual([
			'spectra.control.actual.read',
		]);
	});

	test('reads independent media and video actual targets without committing read-side state', async () => {
		const harness = installHarness();
		const audioTarget = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:audio-view',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const videoTarget = {
			...audioTarget,
			mediaId: 'media:video-view',
			kind: 'video' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			const request = payload as ControlReadRequest;
			const target = request.fields.includes('pip') ? videoTarget : audioTarget;
			return actualReadAck(request, target);
		};

		const view = await controlCoordinatorTestApi.getViewSnapshot(7);

		expect(view?.activeMedia).toEqual(audioTarget);
		expect(view?.activeVideo).toEqual(videoTarget);
		expect(harness.contentMessages).toHaveLength(2);
		expect(harness.snapshotEvents).toBe(0);
		expect(harness.storageWrites).toBe(0);
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('projects tab, media, and video ACK targets only into their declared scope', async () => {
		const harness = installHarness();
		const videoTarget = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:video-scope',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		const audioTarget = {
			...videoTarget,
			mediaId: 'media:audio-scope',
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			return actualReadAck(payload as ControlReadRequest, videoTarget);
		};
		await controlCoordinatorTestApi.targetChanged(7, videoTarget);
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target: audioTarget,
			patch: { speed: 1.1 },
			observedStrategies: { speed: 'dom-native' },
		});

		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			patch: { tabMuted: true },
		});
		let snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(audioTarget);
		expect(snapshot?.activeVideo).toEqual(videoTarget);

		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.intent.execute') throw new Error(`Unexpected ${type}`);
			const intent = payload as ControlIntent;
			return {
				ok: true,
				data: { ...appliedPatchAck(intent, () => 'dom-native'), target: videoTarget },
			};
		};
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: videoTarget,
			patch: { pip: true },
		});
		snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(audioTarget);
		expect(snapshot?.activeVideo).toEqual(videoTarget);
	});

	test('rejects ambiguous mixed media/video routing before resolving the wrong target', async () => {
		const harness = installHarness();
		await expect(controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: null,
			patch: { speed: 1.25, pip: true },
		})).rejects.toThrow('require one explicit video target');
		expect(harness.contentMessages).toHaveLength(0);
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('keeps media and video identities independent across video operations and source release', async () => {
		const harness = installHarness();
		const videoTarget = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:video-lifecycle',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		const audioTarget = {
			...videoTarget,
			mediaId: 'media:audio-lifecycle',
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			return actualReadAck(payload as ControlReadRequest, videoTarget);
		};
		await controlCoordinatorTestApi.targetChanged(7, videoTarget);
		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target: audioTarget,
			patch: { speed: 1.2 },
			observedStrategies: { speed: 'dom-native' },
		});

		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.operation.execute') throw new Error(`Unexpected ${type}`);
			const intent = payload as ControlOperationIntent<'frame-step'>;
			const currentTime = 10.04;
			return {
				ok: true,
				data: {
					operationId: intent.operationId,
					tabId: intent.tabId,
					documentId: intent.documentId,
					generation: intent.generation,
					revision: intent.baseRevision + 1,
					target: videoTarget,
					operation: 'frame-step' as const,
					strategy: 'dom-native' as const,
					coverage: 'active-target' as const,
					fields: {
						currentTime: {
							desired: currentTime,
							actual: currentTime,
							revision: intent.baseRevision + 1,
							phase: 'applied' as const,
							strategy: 'dom-native' as const,
							coverage: 'active-target' as const,
							controlled: true,
							intentId: intent.operationId,
							lastError: null,
						},
					},
					result: { currentTime, frameDuration: 0.04, approximate: true },
				},
			};
		};
		await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target: videoTarget,
			operation: 'frame-step',
			payload: { direction: 1 },
		});
		let snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(audioTarget);
		expect(snapshot?.activeVideo).toEqual(videoTarget);

		await controlCoordinatorTestApi.sourceReleased(7, audioTarget);
		snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toBeNull();
		expect(snapshot?.activeVideo).toEqual(videoTarget);

		await controlCoordinatorTestApi.sourceReleased(7, videoTarget);
		snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toBeNull();
		expect(snapshot?.activeVideo).toBeNull();
	});

	test('does not retry a terminal content-native failure through a Background MAIN fallback', async () => {
		const harness = installHarness();
		harness.url = 'https://media.example/watch/test';
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.5 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		harness.resolveContent({
			ok: true,
			data: speedErrorAck(harness.contentIntent, 'user-activation-required'),
		});

		const acknowledgement = await pending;
		expect(acknowledgement.fields.speed).toMatchObject({
			phase: 'error',
			strategy: 'unsupported',
			lastError: { code: 'user-activation-required' },
		});
		expect(harness.mainExecutions).toBe(0);
	});

	test('does not widen a media-native failure into a Background MAIN full-output fallback', async () => {
		const harness = installHarness();
		harness.url = 'https://media.example/watch/test';
		const pending = controlCoordinatorTestApi.submit({
			...request({ speed: 1.5 }),
			requestedCoverage: 'full',
		});
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		harness.resolveContent({
			ok: true,
			data: speedErrorAck(harness.contentIntent, 'coverage-incomplete'),
		});

		const ack = await pending;
		expect(ack.fields.speed).toMatchObject({ phase: 'error', strategy: 'unsupported' });
		expect(harness.mainExecutions).toBe(0);
	});

	test('commits audio reset as one revision after target and processor ACKs', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:1',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			expect(type).toBe('spectra.control.intent.execute');
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: intent.requestedCoverage === 'full'
					? releasedPatchAck(intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		const ack = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'audio-reset',
			payload: {},
		});

		expect(intents).toHaveLength(2);
		expect(intents[0]?.patch).toEqual({
			volumeBase: 100,
			mediaMuted: false,
		});
		expect(intents[0]?.patch).not.toHaveProperty('speed');
		expect(intents[1]?.actualContext).toEqual({
			volumeBase: 100,
			mediaMuted: false,
			preservePitch: true,
		});
		expect(intents[1]?.actualContext).not.toHaveProperty('speed');
		expect(ack).toMatchObject({ revision: 1, result: { reset: true } });
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.revision).toBe(1);
		expect(harness.snapshotEvents).toBe(1);
	});

	test('resolves the live active media during reset when passive bootstrap readback has no target', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:discovered',
			sourceRevision: 2,
			kind: 'audio' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, null);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			const acknowledgement = intent.requestedCoverage === 'full'
				? releasedPatchAck(intent)
				: appliedPatchAck(intent, () => 'dom-native');
			if (intent.requestedCoverage === 'active-target') acknowledgement.target = target;
			return {
				ok: true,
				data: acknowledgement,
			};
		};

		const ack = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target: null,
			operation: 'audio-reset',
			payload: {},
		});

		expect(harness.contentMessages.map(({ type }) => type)).toEqual([
			'spectra.control.actual.read',
			'spectra.control.actual.read',
			'spectra.control.actual.read',
			'spectra.control.intent.execute',
			'spectra.control.intent.execute',
		]);
		expect(intents).toHaveLength(2);
		expect(intents[0]?.target).toBeNull();
		expect(intents[1]?.target).toEqual(target);
		expect(ack.target).toEqual(target);
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.activeMedia).toEqual(target);
		expect(harness.snapshotEvents).toBe(1);
	});

	test('releases page settings and the processor in one snapshot transaction', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:1',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		let processorIntent: ControlIntent | null = null;
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			if (type === 'spectra.control.operation.execute') {
				const intent = payload as ControlOperationIntent<'restore-page-settings'>;
				const fields: ControlFieldStates = {
					volumeBase: {
						desired: null,
						actual: 72,
						revision: intent.baseRevision + 1,
						phase: 'applied',
						strategy: 'dom-native',
						coverage: 'active-target',
						controlled: false,
						intentId: intent.operationId,
						lastError: null,
					},
				};
				const operationAck: ControlOperationAck<'restore-page-settings'> = {
					operationId: intent.operationId,
					tabId: intent.tabId,
					documentId: intent.documentId,
					generation: intent.generation,
					revision: intent.baseRevision + 1,
					target,
					operation: 'restore-page-settings',
					strategy: 'extension-state',
					coverage: 'active-target',
					fields,
					result: { releasedFields: ['volumeBase'] },
				};
				return { ok: true, data: operationAck };
			}
			processorIntent = payload as ControlIntent;
			return { ok: true, data: releasedPatchAck(processorIntent) };
		};

		const ack = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'restore-page-settings',
			payload: {},
		});

		expect(processorIntent?.actualContext.volumeBase).toBe(72);
		expect(ack.revision).toBe(1);
		expect(ack.result.releasedFields).toContain('volumeBase');
		expect(ack.result.releasedFields).toContain('boost');
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.revision).toBe(1);
		expect(harness.snapshotEvents).toBe(1);
	});

	test('clears retired-source A/B state without regressing a newer active media target', async () => {
		const harness = installHarness();
		const previousTarget = {
			frameId: 0, documentId: harness.documentId, mediaId: 'media:reused',
			sourceRevision: 0, kind: 'video' as const,
		};
		const currentTarget = { ...previousTarget, sourceRevision: 1 };
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.intent.execute') {
				const intent = payload as ControlIntent;
				return { ok: true, data: { ...appliedPatchAck(intent, () => 'dom-native'), target: currentTarget } };
			}
			const intent = payload as ControlOperationIntent<'ab-clear'>;
			const abLoop = { pointA: null, pointB: null, enabled: false };
			return {
				ok: true,
				data: {
					operationId: intent.operationId,
					tabId: intent.tabId,
					documentId: intent.documentId,
					generation: intent.generation,
					revision: intent.baseRevision + 1,
					target: previousTarget,
					operation: 'ab-clear' as const,
					strategy: 'extension-state' as const,
					coverage: 'active-target' as const,
					fields: {
						abLoop: {
							desired: abLoop, actual: abLoop, revision: intent.baseRevision + 1,
							phase: 'applied' as const, strategy: 'extension-state' as const,
							coverage: 'active-target' as const, controlled: false,
							intentId: intent.operationId, lastError: null,
						},
					},
					result: { abLoop, cleared: false },
				},
			};
		};

		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: currentTarget,
			patch: { speed: 1.25 },
		});
		await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'restore',
			target: previousTarget,
			operation: 'ab-clear',
			payload: {},
		});
		const snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.activeMedia).toEqual(currentTarget);
		expect(snapshot?.fields.abLoop?.actual).toEqual({ pointA: null, pointB: null, enabled: false });
	});

	test('still releases the processor without active media and never reports a partial reset', async () => {
		const harness = installHarness();
		let intentCount = 0;
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return {
					ok: false,
					error: {
						code: 'media_target_unavailable',
						message: 'No active media target',
						retryable: true,
					},
				};
			}
			const intent = payload as ControlIntent;
			intentCount += 1;
			if (intent.requestedCoverage === 'active-target') {
				const unavailable = appliedPatchAck(intent, () => 'unsupported');
				for (const state of Object.values(unavailable.fields)) {
					if (!state) continue;
					state.actual = null;
					state.phase = 'error';
					state.controlled = false;
					state.lastError = {
						code: 'capability-unavailable',
						message: 'No active media target',
						retryable: true,
					};
				}
				return { ok: true, data: unavailable };
			}
			const result = releasedPatchAck(intent);
			if (result.fields.boost) {
				result.fields.boost = {
					...result.fields.boost,
					actual: null,
					phase: 'error',
					strategy: 'unsupported',
					coverage: 'partial',
					controlled: false,
					lastError: {
						code: 'audio_runtime_unavailable',
						message: 'processor unavailable',
						retryable: true,
					},
				};
			}
			return { ok: true, data: result };
		};

		await expect(controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target: null,
			operation: 'audio-reset',
			payload: {},
		})).rejects.toThrow('Audio processor reset failed for boost');

		expect(intentCount).toBe(2);
		expect(harness.snapshotEvents).toBe(0);
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('compensates the native writer when the processor half of audio reset fails', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:rollback',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			if (intent.requestedCoverage === 'full' && intent.patch.boost === 1 && intents.length === 2) {
				const failed = releasedPatchAck(intent);
				const failedBoost = requireValue(
					failed.fields.boost,
					'Expected the released full-coverage ACK to include boost state',
				);
				failed.fields.boost = {
					...failedBoost,
					actual: 2,
					phase: 'error',
					strategy: 'media-webaudio',
					controlled: true,
					lastError: { code: 'strategy-runtime-failed', message: 'processor reset failed', retryable: true },
				};
				return { ok: true, data: failed };
			}
			return {
				ok: true,
				data: appliedPatchAck(intent, (field) => (
					field === 'audioEnabled' ? 'extension-state'
						: intent.requestedCoverage === 'full' ? 'media-webaudio' : 'dom-native'
				)),
			};
		};

		await expect(controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'audio-reset',
			payload: {},
		})).rejects.toThrow('Audio processor reset failed for boost');

		expect(intents).toHaveLength(4);
		expect(intents[2]?.patch).toMatchObject({
			volumeBase: 72,
			mediaMuted: false,
		});
		expect(intents[2]?.patch).not.toHaveProperty('speed');
		expect(intents[2]?.patch).not.toHaveProperty('preservePitch');
		expect(harness.snapshotEvents).toBe(0);
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('publishes an explicit error snapshot when transaction compensation also fails', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:partial',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		let intentCount = 0;
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			intentCount += 1;
			const acknowledgement = intent.requestedCoverage === 'full'
				? releasedPatchAck(intent)
				: appliedPatchAck(intent, () => 'dom-native');
			if (intentCount === 2 || intentCount === 3) {
				const field = intentCount === 2 ? 'boost' : 'volumeBase';
				(acknowledgement.fields as Record<string, unknown>)[field] = {
					desired: intent.patch[field],
					actual: intentCount === 2 ? 2 : 100,
					revision: intent.baseRevision + 1,
					phase: 'error',
					strategy: intentCount === 2 ? 'media-webaudio' : 'dom-native',
					coverage: intent.requestedCoverage,
					controlled: true,
					intentId: intent.intentId,
					lastError: { code: 'readback-mismatch', message: 'forced failure', retryable: true },
				};
			}
			return { ok: true, data: acknowledgement };
		};

		await expect(controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'audio-reset',
			payload: {},
		})).rejects.toThrow('Audio processor reset failed for boost');

		const snapshot = await controlCoordinatorTestApi.getSnapshot(7);
		expect(snapshot?.fields.volumeBase).toMatchObject({
			phase: 'error',
			controlled: false,
			lastError: { code: 'transaction-rollback-failed' },
		});
		expect(harness.snapshotEvents).toBe(1);
	});
});
