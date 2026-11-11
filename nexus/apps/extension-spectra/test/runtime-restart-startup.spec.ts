import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HOTKEY_SETTINGS,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	type ContentRuntimeSourceOwnership,
} from '@nexus/contracts';
import {
	recoverDocumentRuntimeOnWorkerStartup,
	runtimeRestartStartupTestApi,
	type RuntimeRestartStartupPort,
	type RuntimeRestartStatus,
	type RuntimeRestartTarget,
} from '../src/background/runtime-restart-startup';

const target: RuntimeRestartTarget = {
	tabId: 7,
	documentId: 'document-7',
	url: 'https://media.example/watch',
};

function ownedSource(): ContentRuntimeSourceOwnership {
	return {
		target: {
			frameId: 0,
			documentId: 'document-7',
			mediaId: 'media-1',
			sourceRevision: 1,
			kind: 'audio',
		},
		markerCount: 1,
		abActive: false,
	};
}

function harness(options: {
	status?: Partial<RuntimeRestartStatus>;
	restoreCapability?: string | null;
	audioSessionDurable?: boolean;
	mediaObservation?: boolean;
	hotkeyMode?: 'none' | 'lean' | 'full';
	failRestoreResolution?: boolean;
	failHotkeys?: boolean;
} = {}) {
	const events: string[] = [];
	const status: RuntimeRestartStatus = {
		ready: options.status?.ready ?? true,
		runtimeRevision: options.status?.runtimeRevision ?? SPECTRA_CONTENT_RUNTIME_REVISION,
		ownedSources: options.status?.ownedSources ?? [],
		mediaIntentState: options.status?.mediaIntentState,
	};
	const port: RuntimeRestartStartupPort = {
		async readStatus() {
			events.push('status');
			return status;
		},
		async retainRecoveryRuntime() {
			events.push('retain-recovery');
		},
		releaseRecoveryRuntime() {
			events.push('release-recovery');
		},
		async resolvePersistentRestoreCapability() {
			events.push('resolve-restore');
			if (options.failRestoreResolution) throw new Error('restore authority unavailable');
			return options.restoreCapability ?? null;
		},
		async retainRestoreRuntime(_target, capability) {
			events.push(`retain-restore:${capability}`);
		},
		async resolvePersistentAudioSession() {
			events.push('resolve-audio');
			return options.audioSessionDurable ?? false;
		},
		async retainAudioSessionRuntime() {
			events.push('retain-audio');
		},
		async resolvePersistentMediaObservation() {
			events.push('resolve-observation');
			return options.mediaObservation ?? false;
		},
		async retainMediaObservationRuntime() {
			events.push('retain-observation');
		},
		async reconcileHotkeys() {
			events.push('hotkeys');
			if (options.failHotkeys) throw new Error('hotkey reconstruction failed');
			return options.hotkeyMode ?? 'none';
		},
	};
	return { events, port };
}

describe('MV3 startup runtime recovery adapter', () => {
	test('filters frozen, discarded and unloaded tabs before reading frames and scopes retries to the same failed document', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const frameReads: number[] = [];
		const tabs = [
			{ id: 1, url: 'https://media.example/a', status: 'complete' },
			{ id: 2, url: 'https://media.example/b', frozen: true },
			{ id: 3, url: 'https://media.example/c', discarded: true },
			{ id: 4, url: 'https://media.example/d', status: 'unloaded' },
			{ id: 5, url: 'chrome://settings/' },
			{ id: 6, url: 'https://media.example/committing', status: 'loading' },
		] as chrome.tabs.Tab[];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { query: async () => tabs },
			webNavigation: { getFrame: async ({ tabId }: { tabId: number }) => {
				frameReads.push(tabId); return { documentId: `document-${tabId}`, url: `https://media.example/${tabId}` };
			} },
		} });
		try {
			const discovered = await runtimeRestartStartupTestApi.currentHttpTargets();
			expect(discovered.map((item) => item.tabId).sort()).toEqual([1, 6]);
			expect(frameReads.sort()).toEqual([1, 6]);
			frameReads.length = 0;
			const retry = await runtimeRestartStartupTestApi.currentHttpTargets(new Map([[1, { ...target, tabId: 1, documentId: 'document-old' }], [2, { ...target, tabId: 2 }]]));
			expect(retry).toEqual([]);
			expect(frameReads).toEqual([1]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('retries only failed runnable targets instead of reproving healthy documents', async () => {
		const queued: Array<() => void> = [];
		const scopeReads: Array<number[] | null> = [];
		const recovered: number[] = [];
		const targets = [1, 2].map((tabId) => ({ ...target, tabId, documentId: `document-${tabId}` }));
		let firstFailure = true;
		runtimeRestartStartupTestApi.initialize({
			readSettings: async () => DEFAULT_HOTKEY_SETTINGS,
			discoverTargets: async (retryOnly) => {
				scopeReads.push(retryOnly ? [...retryOnly.keys()] : null);
				return targets.filter((item) => !retryOnly || retryOnly.has(item.tabId));
			},
			recover: async (item) => {
				recovered.push(item.tabId);
				if (item.tabId === 2 && firstFailure) { firstFailure = false; throw new Error('temporarily-unavailable'); }
			},
			schedule: (callback) => { queued.push(callback); },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(recovered).toEqual([1, 2]);
		expect(queued).toHaveLength(1);
		queued.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(recovered).toEqual([1, 2, 2]);
		expect(scopeReads).toEqual([null, [2]]);
		expect(queued).toEqual([]);
	});

	test.each(['discovery', 'document'] as const)('terminates repeated %s failures after the canonical bounded retry schedule', async (phase) => {
		const queued: Array<() => void> = [];
		const delays: number[] = [];
		const scopes: Array<number[] | null> = [];
		let attempts = 0;
		runtimeRestartStartupTestApi.initialize({
			readSettings: async () => DEFAULT_HOTKEY_SETTINGS,
			discoverTargets: async (retryOnly) => {
				attempts += 1;
				scopes.push(retryOnly ? [...retryOnly.keys()] : null);
				if (phase === 'discovery') throw new Error('discovery-unavailable');
				return [target];
			},
			recover: async () => { throw new Error('document-unavailable'); },
			schedule: (callback, delay) => { queued.push(callback); delays.push(delay); },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (let retry = 0; retry < 3; retry += 1) {
			expect(queued).toHaveLength(1);
			queued.shift()?.();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(delays).toEqual([250, 1_000, 4_000]);
		expect(attempts).toBe(4);
		expect(queued).toEqual([]);
		expect(scopes).toEqual(phase === 'discovery' ? [null, null, null, null] : [null, [7], [7], [7]]);
	});
	test.each(['released', 'retained'] as const)('uses the surviving document template instead of inferring it from old resource actuals (%s)', async (mediaIntentState) => {
		const h = harness({ status: { mediaIntentState }, restoreCapability: 'settings:old-resource' });
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).not.toContain('resolve-restore');
		expect(h.events.includes('retain-restore:document-media-intent')).toBe(mediaIntentState === 'retained');
		expect(h.events.at(-1)).toBe('release-recovery');
	});
	test('releases only the temporary recovery lease when a surviving runtime has no durable owner', async () => {
			const h = harness();
			await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
			expect(h.events).toEqual([
				'status',
				'retain-recovery',
				'resolve-restore',
				'resolve-audio',
				'resolve-observation',
				'hotkeys',
				'release-recovery',
			]);
		});

	test('reconstructs the exact restore capability before dropping the temporary lease', async () => {
		const h = harness({ restoreCapability: 'settings:canonical.example' });
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).toEqual([
			'status',
			'retain-recovery',
			'resolve-restore',
			'retain-restore:settings:canonical.example',
			'hotkeys',
			'release-recovery',
		]);
	});

	test('treats recovered source ownership as durable before releasing the probe lease', async () => {
		const h = harness({ status: { ownedSources: [ownedSource()] } });
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events.at(-1)).toBe('release-recovery');
		expect(h.events).toContain('retain-recovery');
	});

	test('keeps the heavy runtime through the full hotkey owner then drops only the recovery lease', async () => {
			const h = harness({ hotkeyMode: 'full' });
			await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
			expect(h.events).toEqual([
				'status',
				'retain-recovery',
				'resolve-restore',
				'resolve-audio',
				'resolve-observation',
				'hotkeys',
				'release-recovery',
			]);
		});

	test('does not create a heavy restore runtime when bootstrap confirms none survived', async () => {
			const h = harness({
				status: { ready: false, runtimeRevision: null },
				restoreCapability: 'settings:canonical.example',
				hotkeyMode: 'none',
			});
			await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
			expect(h.events).toEqual([
				'status',
				'release-recovery',
				'resolve-restore',
				'hotkeys',
			]);
			expect(h.events.some((event) => event.startsWith('retain-restore:'))).toBe(false);
		});

	test('keeps the surviving runtime for a persisted live processor session across worker restarts', async () => {
		const h = harness({ audioSessionDurable: true });
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).toEqual([
			'status',
			'retain-recovery',
			'resolve-restore',
			'resolve-audio',
			'retain-audio',
			'resolve-observation',
			'hotkeys',
			'release-recovery',
		]);
	});

	test('keeps the surviving runtime as an observation owner when its document reported media', async () => {
		const h = harness({ mediaObservation: true });
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).toEqual([
			'status',
			'retain-recovery',
			'resolve-restore',
			'resolve-audio',
			'resolve-observation',
			'retain-observation',
			'hotkeys',
			'release-recovery',
		]);
	});

	test('does not resurrect a dead runtime for a media observation owner', async () => {
		const h = harness({
			status: { ready: false, runtimeRevision: null },
			mediaObservation: true,
		});
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).not.toContain('retain-observation');
	});

	test('does not resurrect a dead runtime for a persisted processor session', async () => {
		const h = harness({
			status: { ready: false, runtimeRevision: null },
			audioSessionDurable: true,
		});
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).toEqual([
			'status',
			'release-recovery',
			'resolve-restore',
			'resolve-audio',
			'hotkeys',
		]);
		expect(h.events).not.toContain('retain-audio');
	});

	test('retains the safety lease when restore reconstruction fails', async () => {
		const h = harness({ failRestoreResolution: true });
		await expect(recoverDocumentRuntimeOnWorkerStartup(
			target,
			DEFAULT_HOTKEY_SETTINGS,
			h.port,
		)).rejects.toThrow('restore authority unavailable');
		expect(h.events).toEqual(['status', 'retain-recovery', 'resolve-restore']);
		expect(h.events).not.toContain('release-recovery');
	});

	test('retains the safety lease when hotkey reconstruction fails', async () => {
			const h = harness({ failHotkeys: true });
			await expect(recoverDocumentRuntimeOnWorkerStartup(
				target,
				DEFAULT_HOTKEY_SETTINGS,
				h.port,
			)).rejects.toThrow('hotkey reconstruction failed');
			expect(h.events).toEqual([
				'status',
				'retain-recovery',
				'resolve-restore',
				'resolve-audio',
				'resolve-observation',
				'hotkeys',
			]);
			expect(h.events).not.toContain('release-recovery');
		});

	test('fails closed before acquiring ownership for an unexpected surviving runtime revision', async () => {
		const h = harness({ status: { runtimeRevision: 'old-runtime' } });
		await expect(recoverDocumentRuntimeOnWorkerStartup(
			target,
			DEFAULT_HOTKEY_SETTINGS,
			h.port,
		)).rejects.toThrow('Unexpected surviving runtime revision');
		expect(h.events).toEqual(['status']);
	});

	test('uses one bounded retry schedule for both document and discovery failures', () => {
		expect(runtimeRestartStartupTestApi.RETRY_DELAYS_MS).toEqual([250, 1_000, 4_000]);
		expect(runtimeRestartStartupTestApi.retryDelayForAttempt(0)).toBe(250);
		expect(runtimeRestartStartupTestApi.retryDelayForAttempt(1)).toBe(1_000);
		expect(runtimeRestartStartupTestApi.retryDelayForAttempt(2)).toBe(4_000);
		expect(runtimeRestartStartupTestApi.retryDelayForAttempt(3)).toBeNull();
	});
});
