// goal: safely retire orphan heavy Content Runtime state after an MV3 worker restart
// inv: reconstruct every durable owner before deciding that a surviving runtime is orphaned

export interface RuntimeRestartRecoveryPort {
	/** Probe the current document runtime. Implementations recover source-owned leases as a side effect. */
	probeExistingRuntime(): Promise<boolean>;
	/** Reconstruct persistent document restore/preset ownership. */
	restoreDocumentOwnership(): Promise<void>;
	/** Reconstruct the current configured-site hotkey owner (full/lean/none). */
	reconcileHotkeyOwnership(): Promise<void>;
	/** True after all recovered owners above have been projected into Background lease state. */
	hasRuntimeLease(): boolean;
	/** Retire a probed runtime that no reconstructed owner still needs. */
	disposeOrphanRuntime(): Promise<void>;
}

export interface RuntimeRestartRecoveryResult {
	readonly runtimeWasPresent: boolean;
	readonly disposedOrphan: boolean;
}

export async function recoverDocumentRuntimeAfterWorkerRestart(
	port: RuntimeRestartRecoveryPort,
): Promise<RuntimeRestartRecoveryResult> {
	const runtimeWasPresent = await port.probeExistingRuntime();

	// Rebuild persistent owners before any destructive decision. If either step
	// throws, the caller receives that failure and the old runtime is deliberately
	// left untouched rather than being guessed orphaned.
	await port.restoreDocumentOwnership();
	await port.reconcileHotkeyOwnership();

	if (runtimeWasPresent && !port.hasRuntimeLease()) {
		await port.disposeOrphanRuntime();
		return { runtimeWasPresent: true, disposedOrphan: true };
	}
	return { runtimeWasPresent, disposedOrphan: false };
}
