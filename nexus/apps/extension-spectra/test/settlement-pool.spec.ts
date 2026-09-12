import { describe, expect, spyOn, test } from 'bun:test';
import { createSettlementPool, observeWithin } from '@nexus/kernel';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}

describe('physical settlement capacity', () => {
	test('exposes pending age without releasing an unsettled permit', async () => {
		const pool = createSettlementPool<string, number>(1);
		const pending = deferred<number>();
		const operation = pool.getOrStart('document:old', () => pending.promise);
		if (!operation) throw new Error('initial permit missing');
		expect(pool.getPending('document:old')?.operation).toBe(operation);
		expect(pool.readPending()).toEqual([
			expect.objectContaining({ key: 'document:old', startedAt: expect.any(Number) }),
		]);
		expect(pool.getOrStart('document:new', async () => 2)).toBeNull();
		pending.resolve(1);
		await operation;
		expect(pool.pendingCount).toBe(0);
	});

	test('deduplicates a key and claims capacity before invoking the operation', async () => {
		const pool = createSettlementPool<string, number>(1);
		const pending = deferred<number>();
		let calls = 0;
		const first = pool.getOrStart('a', () => { calls++; return pending.promise; });
		expect(pool.pendingCount).toBe(1);
		expect(pool.getOrStart('a', () => Promise.resolve(99))).toBe(first);
		expect(pool.getOrStart('b', () => Promise.resolve(42))).toBeNull();
		pending.resolve(7);
		expect(await first).toBe(7);
		expect(calls).toBe(1);
		expect(pool.pendingCount).toBe(0);
	});

	test('an observer timeout does not release a physically occupied permit', async () => {
		const pool = createSettlementPool<string, number>(1);
		const pending = deferred<number>();
		const operation = pool.getOrStart('a', () => pending.promise);
		if (!operation) throw new Error('initial permit missing');
		expect(await observeWithin(operation, 5)).toEqual({ settled: false });
		expect(pool.pendingCount).toBe(1);
		expect(pool.getOrStart('b', () => Promise.resolve(3))).toBeNull();
		pending.resolve(8);
		await operation;
		expect(pool.pendingCount).toBe(0);
		expect(await pool.getOrStart('b', () => Promise.resolve(3))).toBe(3);
	});

	test('a late rejection is handled and releases its permit', async () => {
		const pool = createSettlementPool<string, number>(1);
		const pending = deferred<number>();
		const operation = pool.getOrStart('a', () => pending.promise);
		if (!operation) throw new Error('initial permit missing');
		expect(await observeWithin(operation, 5)).toEqual({ settled: false });
		pending.reject(new Error('retired receiver'));
		await operation.catch(() => undefined);
		expect(pool.pendingCount).toBe(0);
	});

	test('synchronous failure releases the reserved key and remains observable', async () => {
		const pool = createSettlementPool<string, number>(1);
		const operation = pool.getOrStart('a', () => { throw new Error('sync failure'); });
		expect(operation).not.toBeNull();
		await expect(operation).rejects.toThrow('sync failure');
		expect(pool.pendingCount).toBe(0);
	});

	test('rejects invalid capacity and deadline parameters', () => {
		for (const value of [0, -1, 0.5, NaN, Infinity]) {
			expect(() => createSettlementPool(value)).toThrow();
		}
		for (const value of [0, -1, NaN, Infinity]) {
			expect(() => observeWithin(Promise.resolve(1), value)).toThrow();
		}
	});
});

test('expired observations leave one physical Promise reaction, not one per retry', async () => {
	const pending = deferred<number>();
	const registrations = spyOn(pending.promise, 'then');
	for (let index = 0; index < 20; index++) expect(await observeWithin(pending.promise, 1)).toEqual({ settled: false });
	expect(registrations).toHaveBeenCalledTimes(1);
	pending.resolve(23);
	expect(await observeWithin(pending.promise, 100)).toEqual({ settled: true, value: 23 });
	expect(await observeWithin(pending.promise, 100)).toEqual({ settled: true, value: 23 });
	expect(registrations).toHaveBeenCalledTimes(1);
});

test('a shared late failure rejects current and subsequent observers without an unhandled rejection', async () => {
	const pending = deferred<number>();
	expect(await observeWithin(pending.promise, 1)).toEqual({ settled: false });
	const active = observeWithin(pending.promise, 100);
	pending.reject(new Error('late failure'));
	await expect(active).rejects.toThrow('late failure');
	await expect(observeWithin(pending.promise, 100)).rejects.toThrow('late failure');
});
