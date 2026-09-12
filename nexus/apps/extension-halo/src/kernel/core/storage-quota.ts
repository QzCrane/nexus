// goal: native Chrome quota admission for growing domain-owned storage values

export interface StorageQuotaPolicy {
	/** Maximum share of the browser-reported area quota owned by this key. */
	readonly maxAreaFraction: number;
	/** Maximum quota share admitted for any one user-owned item. */
	readonly maxItemAreaFraction?: number;
	/** Headroom retained for unrelated settings and recovery writes. */
	readonly reserveFraction?: number;
}

function validFraction(value: number): boolean {
	return Number.isFinite(value) && value > 0 && value < 1;
}

export async function admitStorageGrowth(
	areaName: 'local' | 'sync' | 'session',
	keysBeingReplaced: readonly string[],
	nextRecord: Record<string, unknown>,
	policy: StorageQuotaPolicy,
	itemBytes: readonly number[] = [],
): Promise<boolean> {
	const reserveFraction = policy.reserveFraction ?? 0.2;
	if (!validFraction(policy.maxAreaFraction) || !validFraction(reserveFraction)
		|| (policy.maxItemAreaFraction !== undefined && !validFraction(policy.maxItemAreaFraction))) {
		throw new RangeError('Storage quota fractions must be between zero and one');
	}
	const area = chrome.storage[areaName];
	const quota = 'QUOTA_BYTES' in area && typeof area.QUOTA_BYTES === 'number'
		? area.QUOTA_BYTES
		: 0;
	if (!Number.isFinite(quota) || quota <= 0) {
		throw new Error(`The ${areaName} storage quota is unavailable`);
	}
	const [currentAreaBytes, currentDomainBytes] = await Promise.all([
		area.getBytesInUse(),
		area.getBytesInUse([...keysBeingReplaced]),
	]);
	const encoder = new TextEncoder();
	const nextDomainBytes = Object.entries(nextRecord).reduce((total, [key, value]) => {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new TypeError('Storage quota admission requires JSON values');
		return total + encoder.encode(key).byteLength + encoder.encode(serialized).byteLength;
	}, 0);
	const projectedAreaBytes = currentAreaBytes - currentDomainBytes + nextDomainBytes;
	const domainCeiling = Math.floor(quota * policy.maxAreaFraction);
	const itemCeiling = Math.floor(quota * (policy.maxItemAreaFraction ?? policy.maxAreaFraction));
	const areaCeiling = Math.floor(quota * (1 - reserveFraction));

	// Existing over-budget data remains editable when the mutation reduces it.
	if (nextDomainBytes > currentDomainBytes && nextDomainBytes > domainCeiling) return false;
	if (nextDomainBytes > currentDomainBytes && itemBytes.some((bytes) => bytes > itemCeiling)) return false;
	if (projectedAreaBytes > currentAreaBytes && projectedAreaBytes > areaCeiling) return false;
	return true;
}
