import { describe, expect, test } from 'bun:test';
import { createBoundedMap, createBoundedSet } from '@nexus/contracts';

describe('bounded registry', () => {
	test('declares a cap and a ttl before it can hold anything', () => {
		// INV-12 is a declaration, not a convention: omitting either member is a
		// type error, and a non-positive cap is a construction error.
		expect(() => createBoundedMap<string, number>({ cap: 0, ttlMs: 1000 })).toThrow();
		expect(() => createBoundedMap<string, number>({ cap: 4, ttlMs: -1 })).toThrow();
		const registry = createBoundedMap<string, number>({ cap: 4, ttlMs: 1000 });
		expect(registry.cap).toBe(4);
		expect(registry.ttlMs).toBe(1000);
	});

	test('evicts the oldest entry instead of growing past its cap', () => {
		const registry = createBoundedSet<string>({ cap: 3, ttlMs: 0 });
		for (const key of ['a', 'b', 'c', 'd']) registry.add(key);
		expect(registry.size).toBe(3);
		expect(registry.has('a')).toBe(false);
		expect(registry.has('d')).toBe(true);
	});

	test('ages entries out without being asked', () => {
		const registry = createBoundedMap<string, number>({ cap: 8, ttlMs: 50 });
		registry.set('stale', 1);
		expect(registry.has('stale')).toBe(true);
		registry.sweep(Date.now() + 51);
		expect(registry.has('stale')).toBe(false);
	});

	test('reuses the value an acquire already produced', () => {
		const registry = createBoundedMap<string, number>({ cap: 4, ttlMs: 0 });
		let made = 0;
		const first = registry.acquire('k', () => { made += 1; return made; });
		const second = registry.acquire('k', () => { made += 1; return made; });
		expect(first).toBe(1);
		expect(second).toBe(1);
		expect(made).toBe(1);
	});
});
