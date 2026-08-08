// goal: deterministic ownership transition between lean exact-document host and full Content Runtime
// inv: every transition first empties the lean host; failures never broaden into an implicit full-runtime fallback

export type SiteHotkeyTransitionMode = 'none' | 'lean' | 'full';

export interface SiteHotkeyTransitionPort {
	barrier(): Promise<void>;
	configureLean(): Promise<void>;
	ensureFull(capability: string): Promise<void>;
	releaseFull(capability: string): void;
}

export interface SiteHotkeyTransitionRequest {
	mode: SiteHotkeyTransitionMode;
	previousFullCapability?: string;
	fullCapability?: string;
}

// post: returns the only full-runtime capability that may remain owned by the document.
export async function reconcileSiteHotkeyTransition(
	request: SiteHotkeyTransitionRequest,
	port: SiteHotkeyTransitionPort,
): Promise<string | null> {
	// One exact empty generation is the sole invalidation seam. If it cannot be
	// delivered, do not alter the old full lease or enable a second owner.
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

	if (request.previousFullCapability && !keepPrevious) {
		port.releaseFull(request.previousFullCapability);
	}

	if (request.mode === 'none') return null;
	if (request.mode === 'lean') {
		// A failed lean configure leaves the document with no site-hotkey owner;
		// never hide that regression by silently retaining/acquiring the heavy host.
		await port.configureLean();
		return null;
	}
	if (keepPrevious) return nextFull ?? null;
	await port.ensureFull(nextFull as string);
	return nextFull as string;
}
