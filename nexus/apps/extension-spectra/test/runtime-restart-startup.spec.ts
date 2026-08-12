import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HOTKEY_SETTINGS,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	type ContentRuntimeSourceOwnership,
} from '@nexus/contracts';
import {
	recoverDocumentRuntimeOnWorkerStartup,
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
	hotkeyMode?: 'none' | 'lean' | 'full';
	failRestoreResolution?: boolean;
	failHotkeys?: boolean;
} = {}) {
	const events: string[] = [];
	const status: RuntimeRestartStatus = {
		ready: options.status?.ready ?? true,
		runtimeRevision: options.status?.runtimeRevision ?? SPECTRA_CONTENT_RUNTIME_REVISION,
		ownedSources: options.status?.ownedSources ?? [],
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
		async reconcileHotkeys() {
			events.push('hotkeys');
			if (options.failHotkeys) throw new Error('hotkey reconstruction failed');
			return options.hotkeyMode ?? 'none';
		},
	};
	return { events, port };
}

describe('MV3 startup runtime recovery adapter', () => {
	test('releases only the temporary recovery lease when a surviving runtime has no durable owner', async () => {
		const h = harness();
		await recoverDocumentRuntimeOnWorkerStartup(target, DEFAULT_HOTKEY_SETTINGS, h.port);
		expect(h.events).toEqual([
			'status',
			'retain-recovery',
			'resolve-restore',
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
});
