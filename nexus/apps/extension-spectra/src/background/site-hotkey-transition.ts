// goal: deterministic ownership transition between lean exact-document host and full Content Runtime
// inv: every transition first empties lean; lean/none also suspends any surviving heavy site-hotkey listener before ownership changes

export type SiteHotkeyTransitionMode = 'none' | 'lean' | 'full';

export interface SiteHotkeyTransitionPort {
	barrier(): Promise<void>;
	suspendFull(): Promise<void>;
	configureLean(): Promise<void>;
	ensureFull(capability: string): Promise<void>;
	releaseFull(capability: string): void;
}

export interface SiteHotkeyTransitionRequest {
	mode: SiteHotkeyTransitionMode;
	previousFullCapability?: string;
	fullCapability?: string;
}

export async function reconcileSiteHotkeyTransition(
	request: SiteHotkeyTransitionRequest,
	port: SiteHotkeyTransitionPort,
): Promise<string | null> {
	// One exact empty generation retires any lean owner first. If this barrier
	// fails, do not alter the old full owner or enable a second path.
	await port.barrier();

	const nextFull = request.mode === 'full' ? request.fullCapability : undefined;
	if (request.mode === 'full' && !nextFull) {
		throw new Error('Full site-hotkey transition requires a capability identity');
	}
	const keepPrevious = Boolean(
		request.previousFullCapability
		&& nextFull
		&& request.previousFullCapability === nextFull,
	);

	if (request.mode !== 'full') {
		// Releasing only the hotkey lease is insufficient when another heavy
		// consumer keeps content-runtime.js resident. Suspend the heavy runtime's
		// configured-site listener before the lease or lean owner changes.
		await port.suspendFull();
	}

	if (request.previousFullCapability && !keepPrevious) {
		port.releaseFull(request.previousFullCapability);
	}

	if (request.mode === 'none') return null;
	if (request.mode === 'lean') {
		await port.configureLean();
		return null;
	}
	if (keepPrevious) return nextFull ?? null;
	await port.ensureFull(nextFull as string);
	return nextFull as string;
}
