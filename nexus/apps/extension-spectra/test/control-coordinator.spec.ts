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
	isCaptureAdmission,
} from '@nexus/contracts';
import {
	acquirePopupVisualizerSource,
	controlCoordinatorTestApi,
	getControlViewSnapshot,
} from '../src/background/control-coordinator';
import type { ExtensionInvocationContext } from '../src/background/extension-invocation';
import { resetBadgeUsageForTests } from '../src/background/badge-usage';
import { badgeState } from '../src/background/state';
import {
	consumeCaptureAdmission,
	revokeCaptureAdmission,
} from '../src/background/capture-admission';
import { createCaptureAdmission } from './helpers/capture-admission';

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
	// Minimal physical-owner stand-in for the Content Capture manager. A
	// capture-start ACK is only legal after the one-shot admission is consumed;
	// later updates may reuse the already active offscreen processor.
	offscreenProcessorActive: boolean;
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
		offscreenProcessorActive: false,
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
			local: {
				get: async (keys: string | string[]) => {
					const result: Record<string, unknown> = {};
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						if (harness.storage.has(key)) result[key] = harness.storage.get(key);
					}
					return result;
				},
				set: async (values: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(values)) harness.storage.set(key, value);
				},
				remove: async (keys: string | string[]) => {
					for (const key of Array.isArray(keys) ? keys : [keys]) harness.storage.delete(key);
				},
			},
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

function unsupportedPatchAck(intent: ControlIntent): ControlApplyAck {
	const revision = intent.baseRevision + 1;
	const fields: ControlFieldStates = {};
	for (const [rawField, desired] of Object.entries(intent.patch)) {
		const field = rawField as ControlField;
		(fields as Record<string, unknown>)[field] = {
			desired,
			actual: null,
			revision,
			phase: 'error',
			strategy: 'unsupported',
			coverage: 'partial',
			controlled: false,
			intentId: intent.intentId,
			lastError: {
				code: 'capability-unavailable',
				message: 'Capture processor requires a current extension invocation',
				retryable: true,
			},
		};
	}
	return {
		intentId: intent.intentId,
		tabId: intent.tabId,
		documentId: intent.documentId,
		generation: intent.generation,
		revision,
		target: intent.target,
		fields,
	};
}

function captureProcessorAck(harness: Harness, intent: ControlIntent): ControlApplyAck {
	expect(intent.requestedCoverage).toBe('full');
	if (!harness.offscreenProcessorActive) {
		const admission = intent.captureAdmission;
		expect(isCaptureAdmission(admission)).toBe(true);
		if (!isCaptureAdmission(admission)) return unsupportedPatchAck(intent);
		const consumed = consumeCaptureAdmission(admission, {
			kind: 'capture-start',
			tabId: intent.tabId,
			documentId: intent.documentId,
		});
		expect(consumed.ok).toBe(true);
		if (!consumed.ok) return unsupportedPatchAck(intent);
		harness.offscreenProcessorActive = true;
	}
	return appliedPatchAck(intent, () => 'capture');
}

function releaseProcessorAck(harness: Harness, intent: ControlIntent): ControlApplyAck {
	harness.offscreenProcessorActive = false;
	return releasedPatchAck(intent);
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

function actualReadAck(payload: ControlReadRequest, target: ControlApplyAck['target'], overrides: Partial<Record<ControlField, unknown>> = {}): unknown {
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
		...overrides,
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
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
	test('fails closed when the durable generation counter cannot be read', async () => {
		const harness = installHarness();
		const chromeMock = globalThis.chrome as unknown as {
			storage: { session: { get: (keys: string | string[]) => Promise<Record<string, unknown>> } };
		};
		const readable = chromeMock.storage.session.get;
		chromeMock.storage.session.get = async () => {
			throw new Error('storage session unavailable');
		};
		try {
			// SP-71: a read failure used to answer 0, which hands the next
			// transaction a lower generation than a content runtime may still hold.
			// An unavailable ordering authority must surface, not be guessed at.
			await expect(getControlViewSnapshot(harness.activeTabId)).rejects.toThrow('storage session unavailable');
		} finally {
			chromeMock.storage.session.get = readable;
		}
	});

	test('rejects background-tab analyser acquisition without issuing Content demand', async () => {
		const harness = installHarness();
		harness.activeTabId = 8;
		await expect(acquirePopupVisualizerSource(7, 'background-observer'))
			.rejects.toThrow('foreground Popup tab');
		expect(harness.contentMessages).toEqual([]);
		expect(harness.offscreenProcessorActive).toBe(false);
	});

	test('mints volatile Capture admission only for an invoked current-tab UI or validated shortcut', async () => {
		const harness = installHarness();
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			expect(type).toBe('spectra.control.intent.execute');
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: harness.offscreenProcessorActive || isCaptureAdmission(intent.captureAdmission)
					? captureProcessorAck(harness, intent)
					: unsupportedPatchAck(intent),
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
		const untrustedAdmission = createCaptureAdmission();
		try {
			await controlCoordinatorTestApi.submit({
				...fullRequest('hotkey', 4),
				captureAdmission: untrustedAdmission,
			});
		} finally {
			revokeCaptureAdmission(untrustedAdmission);
		}
		await controlCoordinatorTestApi.submit(fullRequest('remote', 5));
		await controlCoordinatorTestApi.submit(fullRequest('restore', 6));
		const alternateTarget = invocation(harness, 'chrome-command', 8);
		harness.activeTabId = 7;
		await controlCoordinatorTestApi.submitInvoked(
			fullRequest('hotkey', 7),
			alternateTarget,
		);

		const admissions = intents.map(({ captureAdmission }) => captureAdmission);
		expect(admissions.slice(0, 2).every((admission) => (
			isCaptureAdmission(admission)
			&& admission.kind === 'capture-start'
			&& admission.document.documentId === harness.documentId
		))).toBe(true);
		expect(admissions.slice(2)).toEqual([undefined, undefined, undefined, undefined]);
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

	test('rejects a Popup handoff whose fixed card document was replaced', () => {
		const harness = installHarness();
		const current = invocation(harness, 'popup');
		expect(() => controlCoordinatorTestApi.assertPopupRequestDocument(
			current,
			harness.documentId,
		)).not.toThrow();
		expect(() => controlCoordinatorTestApi.assertPopupRequestDocument(
			current,
			'document-replaced',
		)).toThrow('Popup control belongs to a stale document');
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
			if (type === 'spectra.control.page.scale.probe') {
				return { ok: true, data: { supported: false } };
			}
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, null);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: intent.requestedCoverage === 'full'
					? harness.offscreenProcessorActive || isCaptureAdmission(intent.captureAdmission)
						? captureProcessorAck(harness, intent)
						: unsupportedPatchAck(intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target: null,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 150 },
		}, invocation(harness, 'popup'));
		// The solidified unsupported verdict skips the amplified page write, so
		// the split path starts directly at the native 100 base.
		expect(intents).toHaveLength(2);
		expect(intents.map(({ requestedCoverage }) => requestedCoverage)).toEqual([
			'active-target',
			'full',
		]);
		expect(intents.every(({ captureAdmission }) => (
			isCaptureAdmission(captureAdmission)
			&& captureAdmission.kind === 'capture-start'
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
		expect(intents[0]).toMatchObject({
			requestedCoverage: 'full',
			patch: { boost: 2 },
		});
		expect(intents.every(({ captureAdmission }) => captureAdmission === undefined)).toBe(true);
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
		await controlCoordinatorTestApi.flushSessionProjections();
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
		const invalidation = controlCoordinatorTestApi.beginDocumentNavigation(7);
		harness.resolveContent({ ok: true, data: appliedSpeedAck(staleIntent) });

		await expect(pending).rejects.toThrow(
			/after the document or revision changed|invalidated by navigation/u,
		);
		await invalidation;
		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
	});

	test('keeps the control owner closed after beforeNavigate until commit arrives', async () => {
		const harness = installHarness();
		await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		harness.documentId = 'document-2';
		harness.url = 'https://media.example/two';
		await controlCoordinatorTestApi.beginDocumentNavigation(7);

		expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
		await expect(controlCoordinatorTestApi.submit(request({ tabPinned: false }))).rejects.toThrow(
			/invalidated by navigation/u,
		);

		await controlCoordinatorTestApi.invalidateNavigation(7, false, true);
		const reopened = await controlCoordinatorTestApi.submit(request({ tabPinned: false }));
		expect(reopened.documentId).toBe('document-2');
	});

	test('fences a same-document commit before queued navigation can publish it', async () => {
		const harness = installHarness();
		const first = await controlCoordinatorTestApi.submit(request({ tabPinned: true }));
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.5 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		const staleIntent = harness.contentIntent;

		// History/hash navigation keeps the URL and documentId stable. The
		// synchronous fence must still invalidate an ACK that is awaiting the
		// serialized lifecycle transition.
		const invalidation = controlCoordinatorTestApi.invalidateNavigation(7, true);
		harness.resolveContent({ ok: true, data: appliedSpeedAck(staleIntent) });

		await expect(pending).rejects.toThrow(
			/invalidated by navigation|lost its document or revision|ACK arrived after the document or revision changed/u,
		);
		await invalidation;
		const carried = await controlCoordinatorTestApi.getSnapshot(7);
		expect(carried).toMatchObject({
			documentId: first.documentId,
			generation: first.generation + 1,
			revision: first.revision + 1,
		});
		expect(carried?.fields.tabPinned).toMatchObject({ actual: true, phase: 'applied' });
		expect(carried?.fields.speed).toBeUndefined();
	});

	test('rolls back a snapshot that becomes fenced during persistence', async () => {
		const harness = installHarness();
		const session = chrome.storage.session as unknown as {
			set(values: Record<string, unknown>): Promise<void>;
		};
		const originalSet = session.set;
		let releaseWrite!: () => void;
		let writeStarted!: () => void;
		const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
		const writeStartedSignal = new Promise<void>((resolve) => { writeStarted = resolve; });
		session.set = async (values) => {
			if (Object.keys(values).some((key) => key.startsWith('spectra.control.tab.'))) {
				writeStarted();
				await writeGate;
			}
			return originalSet(values);
		};
		try {
			const pending = controlCoordinatorTestApi.submit(request({ tabPinned: true }));
			await writeStartedSignal;
			const invalidation = controlCoordinatorTestApi.invalidateNavigation(7, true);
			releaseWrite();

			await expect(pending).rejects.toThrow('invalidated by navigation');
			await invalidation;
			expect(harness.snapshotEvents).toBe(0);
			expect(await controlCoordinatorTestApi.getSnapshot(7)).toBeNull();
			expect(harness.storage.has('spectra.control.tab.7')).toBe(false);
		} finally {
			session.set = originalSet;
		}
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
		await controlCoordinatorTestApi.flushSessionProjections();
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
				data: intent.patch.boost === 1
					? releaseProcessorAck(harness, intent)
					: captureProcessorAck(harness, intent),
			};
		};
		await controlCoordinatorTestApi.submitInvoked({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 2 },
		}, invocation(harness, 'popup'));

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

	test('releases the volume processor before native attenuation on a return below 100', async () => {
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
				data: intent.requestedCoverage === 'full'
					? intent.patch.boost === 1
						? releaseProcessorAck(harness, intent)
						: captureProcessorAck(harness, intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 100 },
		});
		await controlCoordinatorTestApi.submitInvoked({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 2 },
		}, invocation(harness, 'popup'));
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
		expect(intents[0]?.processorHold).toBeUndefined();
		expect(harness.offscreenProcessorActive).toBe(false);
		expect(acknowledgement.fields.boost).toMatchObject({
			actual: 1,
			phase: 'idle',
			strategy: 'observe',
			controlled: false,
		});
		expect(acknowledgement.result).toEqual({
			effectiveVolume: 80,
			volumeBase: 80,
			boost: 1,
		});
	});

	test('a later up-cross reacquires a released processor through a fresh invocation', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:effective-roundtrip',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.page.scale.probe') return { ok: true, data: { supported: false } };
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: intent.requestedCoverage === 'full'
					? intent.patch.boost === 1
						? releaseProcessorAck(harness, intent)
						: captureProcessorAck(harness, intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submitInvoked({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 2 },
		}, invocation(harness, 'popup'));
		await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 80 },
		});
		expect(harness.offscreenProcessorActive).toBe(false);
		intents.length = 0;

		const up = await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 120 },
		}, invocation(harness, 'popup'));

		expect(intents.map((intent) => intent.patch)).toEqual([
			{ volumeBase: 100 },
			{ boost: 1.2 },
		]);
		expect(intents.some((intent) => intent.processorHold === true)).toBe(false);
		expect(harness.offscreenProcessorActive).toBe(true);
		expect(up.result).toEqual({ effectiveVolume: 120, volumeBase: 100, boost: 1.2 });
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
			if (type === 'spectra.control.page.scale.probe') {
				return { ok: true, data: { supported: false } };
			}
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
			if (intent.requestedCoverage === 'active-target') {
				return { ok: true, data: unsupportedPatchAck(intent) };
			}
			return {
				ok: true,
				data: captureProcessorAck(harness, intent),
			};
		};

		const acknowledgement = await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 110 },
		}, invocation(harness, 'popup'));
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

	test('answers commits before their durable session projections and preserves per-tab write order', async () => {
		const harness = installHarness();
		// Gate the first tab_session projection write (session storage) so both
		// commits can be acknowledged while the first projection is still pending.
		const gate = deferred<void>();
		let gatedFirstWrite = false;
		const chromeMock = globalThis.chrome as typeof chrome & {
			storage: { session: { set: (values: Record<string, unknown>) => Promise<void> } };
		};
		const originalSessionSet = chromeMock.storage.session.set.bind(chromeMock.storage.session);
		chromeMock.storage.session.set = async (values: Record<string, unknown>) => {
			if (!gatedFirstWrite && Object.keys(values).some((key) => key.startsWith('tab_session_'))) {
				gatedFirstWrite = true;
				await gate.promise;
			}
			await originalSessionSet(values);
		};
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:order',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		const first = controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 60 },
			observedStrategies: { volumeBase: 'page-native' },
		});
		const second = controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 80 },
			observedStrategies: { volumeBase: 'page-native' },
		});
		const [firstAck, secondAck] = await Promise.all([first, second]);
		// Both ACKs resolved without waiting for the detached session writes.
		expect(firstAck.fields.volumeBase.actual).toBe(60);
		expect(secondAck.fields.volumeBase.actual).toBe(80);
		expect(harness.storage.has('tab_session_7')).toBe(false);

		gate.resolve();
		await controlCoordinatorTestApi.flushSessionProjections();
		// Projections ran in commit order: the second write superseded the first.
		expect(harness.storage.get('tab_session_7')).toMatchObject({
			patch: { volumeBase: 80 },
		});
	});

	test('reuses the held runtime lease across later owned-state commits', async () => {
		const harness = installHarness();
		// Use a document isolated from every other test: the owned-state lease
		// and ready-document cache are module state keyed by tab+document, so a
		// shared document would make this assertion order-dependent.
		harness.documentId = 'document-lease';
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:lease',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.page.scale.probe') {
				return { ok: true, data: { supported: false } };
			}
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
			if (intent.requestedCoverage === 'active-target') {
				return { ok: true, data: unsupportedPatchAck(intent) };
			}
			return { ok: true, data: captureProcessorAck(harness, intent) };
		};
		const statusProbes = () => harness.contentMessages
			.filter((message) => message.type === 'spectra.content.runtime.status').length;

		const first = await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 110 },
		}, invocation(harness, 'popup'));
		expect(first.result.effectiveVolume).toBe(110);
		expect(statusProbes()).toBe(1);

		const second = await controlCoordinatorTestApi.submitOperationInvoked({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 120 },
		}, invocation(harness, 'popup'));
		expect(second.result.effectiveVolume).toBe(120);
		// The owned-state lease proves the runtime is alive, so the second
		// commit skips the redundant re-ensure (no new status probe).
		expect(statusProbes()).toBe(1);
	});

	test('uses an acknowledged page-native volume above 100 before considering Capture', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:page-native-volume',
			sourceRevision: 0,
			kind: 'audio' as const,
		};
		const intents: ControlIntent[] = [];
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.page.scale.probe') {
				return { ok: true, data: { supported: true } };
			}
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			if (type === 'spectra.control.page.scale.probe') {
				return { ok: true, data: { supported: true } };
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: intent.requestedCoverage === 'active-target'
					? appliedPatchAck(intent, () => 'page-native')
					: releasedPatchAck(intent),
			};
		};

		const acknowledgement = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'effective-volume',
			payload: { operation: 'set', value: 110 },
		});

		expect(intents.map((intent) => ({
			coverage: intent.requestedCoverage,
			patch: intent.patch,
		}))).toEqual([
			{ coverage: 'active-target', patch: { volumeBase: 110 } },
		]);
		expect(harness.offscreenProcessorActive).toBe(false);
		expect(acknowledgement.fields.boost).toMatchObject({
			actual: 1,
			phase: 'idle',
			strategy: 'observe',
			controlled: false,
		});
		expect(acknowledgement.result).toEqual({
			effectiveVolume: 110,
			volumeBase: 110,
			boost: 1,
		});
		expect(acknowledgement.coverage).toBe('active-target');
		expect(acknowledgement.audioVolume?.volumeState).toBe('native');
		await controlCoordinatorTestApi.flushSessionProjections();
		expect(harness.storage.get('tab_session_7')).toMatchObject({
			patch: { volumeBase: 110, boost: 1 },
		});
	});

	test.each(['acknowledged', 'fresh-read'] as const)(
		'prefers current %s page capability over a stale negative hostname hint',
		async (evidence) => {
			const harness = installHarness();
			harness.storage.set('siteVolumeScales', {
				'media.example': { supported: false, updatedAt: Date.now() },
			});
			const target = {
				frameId: 0, documentId: harness.documentId,
				mediaId: 'media:late-page-controller', sourceRevision: 0, kind: 'audio' as const,
			};
			const intents: ControlIntent[] = [];
			harness.contentResponder = ({ type, payload }) => {
				if (type === 'spectra.control.actual.read') {
					const response = actualReadAck(payload as ControlReadRequest, target);
					if (evidence === 'fresh-read') response.data.observedStrategies.volumeBase = 'page-native';
					return response;
				}
				if (type === 'spectra.control.page.scale.probe') {
					throw new Error('A current page-native observation needs no extra discovery RPC');
				}
				const intent = payload as ControlIntent;
				intents.push(intent);
				return { ok: true, data: intent.requestedCoverage === 'active-target'
					? appliedPatchAck(intent, () => 'page-native') : releasedPatchAck(intent) };
			};
			if (evidence === 'acknowledged') {
				await controlCoordinatorTestApi.submit({
					tabId: 7, source: 'popup', target,
					requestedCoverage: 'active-target', patch: { volumeBase: 80 },
				});
			}
			intents.length = 0;
			const result = await controlCoordinatorTestApi.submitOperation({
				tabId: 7, source: 'popup', target, operation: 'effective-volume',
				payload: { operation: 'set', value: 130 },
			});
			expect(result.result).toEqual({ effectiveVolume: 130, volumeBase: 130, boost: 1 });
			expect(result.fields.volumeBase?.strategy).toBe('page-native');
			expect(intents.map(({ patch }) => patch)).toEqual([{ volumeBase: 130 }]);
			expect(harness.offscreenProcessorActive).toBe(false);
		},
	);

	test('keeps later remote volume increments on the already acknowledged processor owner', async () => {
		const harness = installHarness();
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:capture-volume-owner',
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
				data: intent.requestedCoverage === 'full'
					? captureProcessorAck(harness, intent)
					: appliedPatchAck(intent, () => 'dom-native'),
			};
		};

		await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 100 },
		});
		await controlCoordinatorTestApi.submitInvoked({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'full',
			target,
			patch: { boost: 1.3 },
		}, invocation(harness, 'popup'));
		intents.length = 0;

		const acknowledgement = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'remote',
			target,
			operation: 'effective-volume',
			payload: { operation: 'delta', value: 10 },
		});

		expect(intents.map((intent) => ({
			coverage: intent.requestedCoverage,
			patch: intent.patch,
			captureAdmission: intent.captureAdmission,
		}))).toEqual([{
			coverage: 'full',
			patch: { boost: 1.4 },
			captureAdmission: undefined,
		}]);
		expect(harness.offscreenProcessorActive).toBe(true);
		expect(acknowledgement.result).toEqual({
			effectiveVolume: 140,
			volumeBase: 100,
			boost: 1.4,
		});
		expect(acknowledgement.audioVolume?.volumeState).toBe('capture');
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
				data: appliedPatchAck(intent, (field) => field === 'boost' ? 'observe' : 'dom-native'),
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
		await controlCoordinatorTestApi.flushSessionProjections();
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
						(field) => field === 'boost' ? 'observe' : 'dom-native',
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
			await controlCoordinatorTestApi.flushSessionProjections();
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
		// Session projections are detached from the ACK path; settle them before
		// asserting the durable tab_session row.
		await controlCoordinatorTestApi.flushSessionProjections();
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

	test('rejects a passive read whose responses cross the synchronous navigation fence', async () => {
		const harness = installHarness();
		let releaseReads!: () => void;
		const readGate = new Promise<void>((resolve) => { releaseReads = resolve; });
		harness.contentResponder = ({ type, payload }) => {
			if (type !== 'spectra.control.actual.read') throw new Error(`Unexpected ${type}`);
			return readGate.then(() => actualReadAck(payload as ControlReadRequest, null));
		};

		const pending = controlCoordinatorTestApi.getViewSnapshot(7);
		while (harness.contentMessages.length < 2) await Promise.resolve();
		harness.documentId = 'document-2';
		harness.url = 'https://media.example/two';
		const navigation = controlCoordinatorTestApi.beginDocumentNavigation(7);
		releaseReads();

		await expect(pending).rejects.toThrow(/invalidated by navigation|stale document/u);
		await navigation;
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
			speed: 1,
		});
		expect(intents[1]?.actualContext).toEqual({
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			preservePitch: true,
		});
		expect(ack.fields.speed).toMatchObject({ actual: 1, phase: 'applied' });
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
				return actualReadAck(payload as ControlReadRequest, target, { speed: 1.75 });
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
					strategy: 'unsupported',
					controlled: false,
					lastError: { code: 'strategy-runtime-failed', message: 'processor reset failed', retryable: true },
				};
				return { ok: true, data: failed };
			}
			return {
				ok: true,
				data: appliedPatchAck(intent, (field) => (
					field === 'audioEnabled' ? 'extension-state'
						: intent.requestedCoverage === 'full' ? 'observe' : 'dom-native'
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
			speed: 1.75,
		});
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
					strategy: intentCount === 2 ? 'unsupported' : 'dom-native',
					coverage: intent.requestedCoverage,
					controlled: false,
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
