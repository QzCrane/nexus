// goal: decide per site whether a native write may answer before its
// stabilization confirmation resolves, and demote sites that prove they roll
// writes back

/**
 * `optimistic`: the setter runs, the immediate readback is returned as
 * `written`, and the stabilization window runs detached afterwards.
 *
 * `verified`: the historical behaviour — the transaction awaits the
 * event-quiet window and two render boundaries before it answers.
 */
export type NativeWriteMode = 'optimistic' | 'verified';

export interface NativeWritePolicyThresholds {
	/** How many recent outcomes decide a site's fate. */
	readonly window: number;
	/** Drifts inside the window that demote a site to `verified`. */
	readonly driftLimit: number;
	/**
	 * Global starting point. `verified` is the pre-split behaviour and doubles as
	 * a kill switch: it restores the historical guarantee everywhere without a
	 * redeploy of anything but this value.
	 */
	readonly defaultMode: NativeWriteMode;
}

export const DEFAULT_NATIVE_WRITE_THRESHOLDS: NativeWritePolicyThresholds = {
	window: 8,
	driftLimit: 2,
	defaultMode: 'optimistic',
};

interface SiteLedger {
	/** Most recent outcomes, oldest first, capped at `window`. */
	outcomes: Array<'confirmed' | 'drifted' | 'unconfirmed'>;
}

const ledgers = new Map<string, SiteLedger>();
let thresholds: NativeWritePolicyThresholds = DEFAULT_NATIVE_WRITE_THRESHOLDS;

/**
 * A site key narrows the demotion to the origin that actually misbehaves. The
 * hostname is the finest grain that is both stable across SPA navigations and
 * available without extra permissions.
 */
export function resolveNativeWriteSiteKey(): string {
	const hostname = globalThis.location?.hostname;
	return typeof hostname === 'string' && hostname.length > 0 ? hostname : 'unknown';
}

export function configureNativeWritePolicy(next: Partial<NativeWritePolicyThresholds>): void {
	thresholds = {
		window: next.window ?? thresholds.window,
		driftLimit: next.driftLimit ?? thresholds.driftLimit,
		defaultMode: next.defaultMode ?? thresholds.defaultMode,
	};
}

export function resolveNativeWriteMode(siteKey: string): NativeWriteMode {
	if (thresholds.defaultMode === 'verified') return 'verified';
	const ledger = ledgers.get(siteKey);
	if (!ledger) return 'optimistic';
	let drifts = 0;
	for (const outcome of ledger.outcomes) {
		if (outcome === 'drifted') drifts += 1;
	}
	return drifts >= thresholds.driftLimit ? 'verified' : 'optimistic';
}

/**
 * `unconfirmed` deliberately does not count as drift. A DRM/EME stream that
 * never fires the event is not a page that fights our write, and demoting it
 * would trade a real latency win for a signal that says nothing.
 */
export function recordNativeWriteOutcome(
	siteKey: string,
	outcome: 'confirmed' | 'drifted' | 'unconfirmed',
): void {
	const ledger = ledgers.get(siteKey) ?? { outcomes: [] };
	// The window is self-healing rather than sticky: a site only escapes
	// `verified` after a full window of outcomes that contain no drift, so a
	// one-off page glitch cannot permanently pin an otherwise well-behaved
	// origin, and a genuinely hostile one cannot oscillate quickly.
	ledger.outcomes = [...ledger.outcomes, outcome].slice(-thresholds.window);
	ledgers.set(siteKey, ledger);
}

export interface NativeWritePolicySnapshot {
	readonly thresholds: NativeWritePolicyThresholds;
	readonly sites: ReadonlyArray<{ siteKey: string; mode: NativeWriteMode; drifts: number }>;
}

export function snapshotNativeWritePolicy(): NativeWritePolicySnapshot {
	return {
		thresholds: { ...thresholds },
		sites: [...ledgers.entries()].map(([siteKey, ledger]) => ({
			siteKey,
			mode: resolveNativeWriteMode(siteKey),
			drifts: ledger.outcomes.filter((outcome) => outcome === 'drifted').length,
		})),
	};
}

export function resetNativeWritePolicy(): void {
	ledgers.clear();
	thresholds = DEFAULT_NATIVE_WRITE_THRESHOLDS;
}
