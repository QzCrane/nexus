import { afterEach, describe, expect, test } from 'bun:test';
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
import { controlCoordinatorTestApi } from '../src/background/control-coordinator';

interface Harness {
	documentId: string;
	url: string;
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
		},
	};
}

function request(patch: ControlSubmitRequest['patch']): ControlSubmitRequest {
	return { tabId: 7, source: 'popup', requestedCoverage: 'active-target', target: null, patch };
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
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('authoritative control coordinator', () => {
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
		});

		expect(harness.contentIntent).toBeUndefined();
		expect(ack.fields.volumeBase).toMatchObject({
			desired: 40,
			actual: 40,
			strategy: 'dom-native',
			controlled: false,
		});
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.mediaMuted?.actual).toBe(false);
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

	test('preserves independent Boost when page-native volume changes', async () => {
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
		});

		expect(routed).toHaveLength(1);
		expect(ack.revision).toBe(2);
		expect(ack.fields.volumeBase?.actual).toBe(55);
		expect(ack.fields.boost?.actual).toBeUndefined();
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.fields.boost?.actual).toBe(2);
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.revision).toBe(2);
		expect(harness.snapshotEvents).toBe(2);
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

	test('uses one allowlisted official API invocation only after a retryable DOM failure', async () => {
		const harness = installHarness();
		harness.url = 'https://www.youtube.com/watch?v=test';
		const pending = controlCoordinatorTestApi.submit(request({ speed: 1.5 }));
		while (!harness.contentIntent || !harness.resolveContent) await Promise.resolve();
		harness.resolveContent({
			ok: true,
			data: speedErrorAck(harness.contentIntent, 'write-unsupported'),
		});

		const ack = await pending;
		expect(ack.fields.speed).toMatchObject({ strategy: 'site-native', actual: 1.5 });
		expect(harness.mainExecutions).toBe(1);
	});

	test('does not escalate a terminal native failure into the official site adapter', async () => {
		const harness = installHarness();
		harness.url = 'https://www.youtube.com/watch?v=test';
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

	test('does not let a single-player site adapter claim full-output coverage', async () => {
		const harness = installHarness();
		harness.url = 'https://www.youtube.com/watch?v=test';
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

	test('restores a site-native field through the same official writer and absorbs its reflected event', async () => {
		const harness = installHarness();
		harness.url = 'https://www.youtube.com/watch?v=test';
		const target = {
			frameId: 0,
			documentId: harness.documentId,
			mediaId: 'media:youtube',
			sourceRevision: 0,
			kind: 'video' as const,
		};
		let restoreIntent: ControlOperationIntent<'restore-page-settings'> | null = null;
		harness.contentResponder = ({ type, payload }) => {
			if (type === 'spectra.control.actual.read') {
				return actualReadAck(payload as ControlReadRequest, target);
			}
			if (type === 'spectra.control.operation.execute') {
				restoreIntent = payload as ControlOperationIntent<'restore-page-settings'>;
				return {
					ok: true,
					data: {
						operationId: restoreIntent.operationId,
						tabId: restoreIntent.tabId,
						documentId: restoreIntent.documentId,
						generation: restoreIntent.generation,
						revision: restoreIntent.baseRevision + 1,
						target,
						operation: 'restore-page-settings',
						strategy: 'extension-state',
						coverage: 'active-target',
						fields: {},
						result: { releasedFields: [] },
					},
				};
			}
			const intent = payload as ControlIntent;
			if (intent.patch.speed === 1.5) {
				return { ok: true, data: { ...speedErrorAck(intent, 'write-unsupported'), target } };
			}
			return {
				ok: true,
				data: appliedPatchAck(intent, (field) => (
					field === 'audioEnabled' ? 'extension-state' : 'observe'
				)),
			};
		};

		const applied = await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			patch: { speed: 1.5 },
		});
		expect(applied.fields.speed).toMatchObject({ strategy: 'site-native', actual: 1.5 });
		expect(harness.storage.has('spectra.control.site-native-baseline.7')).toBe(true);

		const reflected = await controlCoordinatorTestApi.submit({
			tabId: 7,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: { speed: 1.5 },
		});
		expect(reflected.revision).toBe(applied.revision);
		expect(harness.snapshotEvents).toBe(1);

		harness.mainResult = { ok: true, before: 1.5, actual: 1 };
		const restored = await controlCoordinatorTestApi.submitOperation({
			tabId: 7,
			source: 'popup',
			target,
			operation: 'restore-page-settings',
			payload: {},
		});
		expect(restoreIntent?.payload).toEqual({ excludedNativeFields: ['speed'] });
		expect(restored.fields.speed).toMatchObject({
			strategy: 'site-native',
			actual: 1,
			controlled: false,
		});
		expect(harness.mainExecutions).toBe(2);
		expect(harness.storage.has('spectra.control.site-native-baseline.7')).toBe(false);
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
		expect(intents[1]?.actualContext).toEqual({
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			preservePitch: true,
		});
		expect(ack).toMatchObject({ revision: 1, result: { reset: true } });
		expect((await controlCoordinatorTestApi.getSnapshot(7))?.revision).toBe(1);
		expect(harness.snapshotEvents).toBe(1);
	});

	test('discovers the actual active media before reset when the background snapshot has no target', async () => {
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
				return actualReadAck(payload as ControlReadRequest, target);
			}
			const intent = payload as ControlIntent;
			intents.push(intent);
			return {
				ok: true,
				data: appliedPatchAck(intent, (field) => (
					field === 'audioEnabled' ? 'extension-state'
						: intent.requestedCoverage === 'full' ? 'observe' : 'dom-native'
				)),
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
		expect(intents[0]?.target).toEqual(target);
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

		expect(intentCount).toBe(1);
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
				failed.fields.boost = {
					...failed.fields.boost!,
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
