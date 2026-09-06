// goal: conditional read-modify-write for shared tool keys so a detected concurrent
// change replaces a silent lost update. A companion revision key is written in the
// same physical `set` call; conflicts are verified after the write and repaired by
// a bounded caller-supplied remerge. This is optimistic concurrency, not a
// cross-context transaction: a legacy plain write that skips the revision key is
// still an unconditional overwrite.
import { safeStorageGet, scheduleStorageOperation } from './safe-storage.js';
import type { StorageArea, StorageOptions } from './safe-storage.js';

export interface LedgerSnapshot<T = unknown> {
	readonly value: T | undefined;
	readonly revision: number;
}

export type LedgerWriteOutcome<T = unknown> =
	| { readonly kind: 'committed'; readonly revision: number; readonly value: T }
	| { readonly kind: 'external'; readonly revision: number; readonly value: T | undefined }
	| { readonly kind: 'rejected' }
	| { readonly kind: 'unknown' };

export interface LedgerReadOptions extends StorageOptions {}

export function ledgerRevisionKey(key: string): string {
	return `${key}#rev`;
}

function storedRevision(value: unknown): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Structural equality for JSON-roundtrip values. Storage content is the ground
// truth for verification because a transport may legitimately drop the
// companion revision key while preserving the value.
function ledgerValueEquals(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((entry, index) => ledgerValueEquals(entry, right[index]));
	}
	if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every((key) => Object.hasOwn(rightRecord, key) && ledgerValueEquals(leftRecord[key], rightRecord[key]));
}

export async function readLedgerEntry<T = unknown>(
	key: string,
	{ area = 'local', timeout = 2000, retries = 0 }: LedgerReadOptions = {},
): Promise<LedgerSnapshot<T>> {
	const revisionKey = ledgerRevisionKey(key);
	const record = await safeStorageGet([key, revisionKey], {}, { area, timeout, retries }) as Record<string, unknown>;
	return {
		value: record[key] as T | undefined,
		revision: storedRevision(record[revisionKey]),
	};
}

export interface ConditionalLedgerWriteOptions<T> {
	readonly area?: StorageArea;
	/** Revision the caller based its value on. A stored revision that differs is a conflict. */
	readonly baseRevision: number;
	readonly value: T;
	/**
	 * Resolve the next value from the freshly stored one after a detected
	 * concurrent change. Return null to concede to the stored value.
	 */
	readonly remerge?: (current: unknown, attempt: number) => T | null;
	readonly maxAttempts?: number;
	readonly timeout?: number;
	readonly retries?: number;
}

const MAX_LEDGER_ATTEMPTS = 5;

function estimateBytes(key: string, value: unknown): number {
	let serialized: string;
	try { serialized = JSON.stringify(value) ?? 'null'; } catch {
		throw new TypeError('Ledger value must be JSON-serializable');
	}
	const encoder = new TextEncoder();
	return encoder.encode(key).byteLength + encoder.encode(serialized).byteLength + 32;
}

export async function conditionalLedgerWrite<T>(
	key: string,
	options: ConditionalLedgerWriteOptions<T>,
): Promise<LedgerWriteOutcome<T>> {
	const area = options.area ?? 'local';
	const maxAttempts = Math.max(1, Math.min(MAX_LEDGER_ATTEMPTS, options.maxAttempts ?? 3));
	const revisionKey = ledgerRevisionKey(key);
	let baseRevision = options.baseRevision;
	let value = options.value;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) return { kind: 'rejected' };
		let snapshot: T;
		let bytes: number;
		try {
			snapshot = structuredClone(value);
			bytes = estimateBytes(key, value);
		} catch {
			return { kind: 'rejected' };
		}
		let conflicted = false;
		let laneRevision = 0;
		let laneValue: unknown;
		const write = scheduleStorageOperation(area, bytes, async (storage) => {
			// Serialized by the area lane, so this check orders same-context writers.
			const stored = await storage.get([key, revisionKey]) as Record<string, unknown>;
			laneRevision = storedRevision(stored[revisionKey]);
			laneValue = stored[key];
			if (laneRevision !== baseRevision) {
				conflicted = true;
				return;
			}
			await storage.set({ [key]: snapshot, [revisionKey]: baseRevision + 1 });
		}, options.retries ?? 0);
		const observed = await write.observe(options.timeout ?? 2000);
		if (observed === 'rejected') return { kind: 'rejected' };
		if (!await write.completion) return { kind: 'rejected' };
		if (conflicted) {
			if (attempt >= maxAttempts || !options.remerge) {
				return { kind: 'external', revision: laneRevision, value: laneValue as T | undefined };
			}
			const merged = options.remerge(laneValue, attempt);
			if (merged === null) {
				return { kind: 'external', revision: laneRevision, value: laneValue as T | undefined };
			}
			baseRevision = laneRevision;
			value = merged;
			continue;
		}
		// The physical write committed at baseRevision + 1. Verify that the
		// stored value still is ours: a concurrent context may have replaced it
		// between the set and this read, and a degraded transport may have
		// dropped the companion revision key.
		let verify: LedgerSnapshot;
		try {
			verify = await readLedgerEntry(key, { area, timeout: options.timeout ?? 2000, retries: options.retries ?? 0 });
		} catch {
			return { kind: 'unknown' };
		}
		if (ledgerValueEquals(verify.value, snapshot)) {
			return { kind: 'committed', revision: verify.revision === baseRevision + 1 ? verify.revision : baseRevision + 1, value: snapshot };
		}
		if (attempt >= maxAttempts || !options.remerge) {
			return { kind: 'external', revision: verify.revision, value: verify.value as T | undefined };
		}
		const merged = options.remerge(verify.value, attempt);
		if (merged === null) {
			return { kind: 'external', revision: verify.revision, value: verify.value as T | undefined };
		}
		baseRevision = verify.revision;
		value = merged;
	}
	return { kind: 'rejected' };
}
