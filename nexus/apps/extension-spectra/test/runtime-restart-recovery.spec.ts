import { describe, expect, test } from 'bun:test';
import {
	recoverDocumentRuntimeAfterWorkerRestart,
	type RuntimeRestartRecoveryPort,
} from '../src/background/runtime-restart-recovery';

function harness(options: {
	runtimePresent?: boolean;
	leaseAfterRestore?: boolean;
	leaseAfterHotkeys?: boolean;
	failRestore?: boolean;
	failHotkeys?: boolean;
} = {}) {
	const events: string[] = [];
	let hasLease = false;
	const port: RuntimeRestartRecoveryPort = {
		async probeExistingRuntime() {
			events.push('probe');
			return options.runtimePresent ?? true;
		},
		async restoreDocumentOwnership() {
			events.push('restore');
			if (options.failRestore) throw new Error('restore failed');
			if (options.leaseAfterRestore) hasLease = true;
		},
		async reconcileHotkeyOwnership() {
			events.push('hotkeys');
			if (options.failHotkeys) throw new Error('hotkeys failed');
			if (options.leaseAfterHotkeys) hasLease = true;
		},
		hasRuntimeLease() {
			events.push('has-lease');
			return hasLease;
		},
		async disposeOrphanRuntime() {
			events.push('dispose');
		},
	};
	return { events, port };
}

describe('MV3 runtime restart recovery', () => {
	test('retires a surviving heavy runtime only after durable owners reconstruct to zero leases', async () => {
		const h = harness({ runtimePresent: true });
		expect(await recoverDocumentRuntimeAfterWorkerRestart(h.port)).toEqual({
			runtimeWasPresent: true,
			disposedOrphan: true,
		});
		expect(h.events).toEqual(['probe', 'restore', 'hotkeys', 'has-lease', 'dispose']);
	});

	test('keeps a surviving runtime when restore ownership is reconstructed', async () => {
		const h = harness({ runtimePresent: true, leaseAfterRestore: true });
		expect(await recoverDocumentRuntimeAfterWorkerRestart(h.port)).toEqual({
			runtimeWasPresent: true,
			disposedOrphan: false,
		});
		expect(h.events).toEqual(['probe', 'restore', 'hotkeys', 'has-lease']);
	});

	test('keeps a surviving runtime when current full hotkeys reconstruct a lease', async () => {
		const h = harness({ runtimePresent: true, leaseAfterHotkeys: true });
		expect(await recoverDocumentRuntimeAfterWorkerRestart(h.port)).toEqual({
			runtimeWasPresent: true,
			disposedOrphan: false,
		});
		expect(h.events).toEqual(['probe', 'restore', 'hotkeys', 'has-lease']);
	});

	test('does nothing destructive when no heavy runtime survived', async () => {
		const h = harness({ runtimePresent: false });
		expect(await recoverDocumentRuntimeAfterWorkerRestart(h.port)).toEqual({
			runtimeWasPresent: false,
			disposedOrphan: false,
		});
		expect(h.events).toEqual(['probe', 'restore', 'hotkeys', 'has-lease']);
	});

	test('never disposes after restore reconstruction fails', async () => {
		const h = harness({ runtimePresent: true, failRestore: true });
		await expect(recoverDocumentRuntimeAfterWorkerRestart(h.port)).rejects.toThrow('restore failed');
		expect(h.events).toEqual(['probe', 'restore']);
		expect(h.events).not.toContain('dispose');
	});

	test('never disposes after hotkey reconstruction fails', async () => {
		const h = harness({ runtimePresent: true, failHotkeys: true });
		await expect(recoverDocumentRuntimeAfterWorkerRestart(h.port)).rejects.toThrow('hotkeys failed');
		expect(h.events).toEqual(['probe', 'restore', 'hotkeys']);
		expect(h.events).not.toContain('dispose');
	});
});
