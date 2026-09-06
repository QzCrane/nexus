// goal: bounded storage observation without releasing unfinished physical mutations
import { observeWithin } from '../settlement-pool.js';

export type StorageArea = 'local' | 'sync' | 'session';
export interface StorageOptions { area?: StorageArea; timeout?: number; retries?: number; }
export type StorageWriteResult = 'committed' | 'rejected' | 'unknown';
export interface StorageWrite {
	readonly completion: Promise<boolean>;
	observe(timeout?: number): Promise<StorageWriteResult>;
}

interface WriteLane { tail: Promise<unknown>; count: number; bytes: number; }
const lanes = new WeakMap<object, WriteLane>();
const MAX_PENDING = 64;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;

function storageArea(area: StorageArea): chrome.storage.StorageArea {
	const storage = typeof chrome !== 'undefined' ? chrome.storage?.[area] : undefined;
	if (!storage) throw new Error('Extension storage is unavailable');
	return storage;
}

function attempts(retries: number): number {
	if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new RangeError('Invalid storage retry count');
	return retries + 1;
}

async function settledRetry<T>(operation: () => Promise<T>, retryCount: number): Promise<T> {
	const count = attempts(retryCount);
	let failure: unknown;
	for (let attempt = 0; attempt < count; attempt++) {
		try { return await operation(); }
		catch (error) {
			failure = error;
			if (attempt + 1 < count) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
		}
	}
	throw failure;
}

function rejectedWrite(): StorageWrite {
	return { completion: Promise.resolve(false), observe: async () => 'rejected' };
}

function scheduleMutation(area: StorageArea, bytes: number, operation: (storage: chrome.storage.StorageArea) => Promise<void>, retries: number): StorageWrite {
	const storage = storageArea(area);
	let lane = lanes.get(storage);
	if (!lane) { lane = { tail: Promise.resolve(), count: 0, bytes: 0 }; lanes.set(storage, lane); }
	if (lane.count >= MAX_PENDING || lane.bytes + bytes > MAX_PENDING_BYTES) return rejectedWrite();
	attempts(retries);
	lane.count++;
	lane.bytes += bytes;
	const owned = lane;
	// The queue is advanced only by actual settlement, never by an observer timeout.
	const completion = lane.tail.then(() => settledRetry(() => operation(storage), retries)).then(
		() => true,
		() => false,
	).finally(() => { owned.count--; owned.bytes -= bytes; });
	lane.tail = completion;
	return {
		completion,
		async observe(timeout = 2000) {
			const observed = await observeWithin(completion, timeout);
			return observed.settled ? observed.value ? 'committed' : 'rejected' : 'unknown';
		},
	};
}

export function scheduleStorageSet(data: Record<string, unknown>, { area = 'local', retries = 0 }: StorageOptions = {}): StorageWrite {
	// Snapshot before enqueuing: later UI mutations cannot change the queued write.
	const snapshot = structuredClone(data);
	const serialized = JSON.stringify(snapshot);
	if (serialized === undefined) throw new TypeError('Storage write must be a JSON record');
	const bytes = new TextEncoder().encode(serialized).byteLength;
	return scheduleMutation(area, bytes, (storage) => storage.set(snapshot), retries);
}

export async function safeStorageSet(data: Record<string, unknown>, options: StorageOptions = {}): Promise<boolean> {
	try { return await scheduleStorageSet(data, options).observe(options.timeout) === 'committed'; }
	catch { return false; }
}

export async function safeStorageRemove(keys: string | string[], options: StorageOptions = {}): Promise<boolean> {
	try {
		const snapshot = typeof keys === 'string' ? keys : [...keys];
		const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
		return await scheduleMutation(options.area ?? 'local', bytes, (storage) => storage.remove(snapshot), options.retries ?? 0).observe(options.timeout) === 'committed';
	} catch { return false; }
}

export async function safeStorageGet<T extends Record<string, unknown>>(
	keys: string | string[] | null, defaults: T, { area = 'local', timeout = 2000, retries = 0 }: StorageOptions = {},
): Promise<T> {
	const storage = storageArea(area);
	const snapshot = Array.isArray(keys) ? [...keys] : keys;
	const outcome = await observeWithin(settledRetry(() => snapshot === null ? storage.get() : storage.get(snapshot), retries), timeout);
	if (!outcome.settled) throw new Error('Storage read deadline exceeded; existing data was not replaced');
	return { ...defaults, ...outcome.value } as T;
}
