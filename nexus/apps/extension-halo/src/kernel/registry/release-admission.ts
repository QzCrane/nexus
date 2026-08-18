// goal: Own HALO product-release status independently from module enablement.
// inv: Product readiness controls shipped executable payload; install/enable state never rewrites it.

export const RELEASE_STATUSES = ['ready', 'beta', 'coming', 'disabled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

const RELEASE_STATUS_SET = new Set<string>(RELEASE_STATUSES);

/**
 * Legacy manifests historically omitted status and were treated as usable by
 * ModuleManager. Preserve that behavior while making the generated/runtime
 * projection explicit. New and migrated manifests should declare status.
 */
export function normalizeReleaseStatus(status: unknown): ReleaseStatus {
	if (status === undefined) return 'ready';
	if (typeof status === 'string' && RELEASE_STATUS_SET.has(status)) {
		return status as ReleaseStatus;
	}
	throw new Error(`invalid HALO release status: ${String(status)}`);
}

export function isReleaseAdmitted(status: unknown): boolean {
	const normalized = normalizeReleaseStatus(status);
	return normalized === 'ready' || normalized === 'beta';
}
