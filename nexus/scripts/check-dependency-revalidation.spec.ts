import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	checkDependencyRevalidation,
	lockedPackageVersion,
} from './check-dependency-revalidation';

const current = JSON.parse(
	readFileSync(new URL('../dependency-revalidation.json', import.meta.url), 'utf8'),
);

describe('direct dependency upstream revalidation snapshot', () => {
	test('matches the exact current package and lock state', () => {
		expect(() => checkDependencyRevalidation()).not.toThrow();
	});

	test('reads scoped and unscoped exact package versions from the Bun lock format', () => {
		const lock = [
			'"@scope/pkg": ["@scope/pkg@1.2.3", "", {}]',
			'"plain": ["plain@4.5.6", "", {}]',
		].join('\n');
		expect(lockedPackageVersion(lock, '@scope/pkg')).toBe('1.2.3');
		expect(lockedPackageVersion(lock, 'plain')).toBe('4.5.6');
		expect(lockedPackageVersion(lock, 'missing')).toBeNull();
	});

	test('rejects a stale observed lock version instead of treating freshness notes as authority', () => {
		const policy = structuredClone(current);
		policy.entries.find((entry: { dependency: string }) => entry.dependency === 'esbuild').lockedVersion = '0.0.0';
		expect(() => checkDependencyRevalidation({ policy })).toThrow('revalidation lock drifted');
	});

	test('rejects omission of one explicitly revalidated dependency', () => {
		const policy = structuredClone(current);
		policy.entries = policy.entries.filter((entry: { dependency: string }) => entry.dependency !== 'jose');
		expect(() => checkDependencyRevalidation({ policy })).toThrow('omitted required direct dependency jose');
	});
});
