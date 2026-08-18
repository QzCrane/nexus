import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	checkDirectDependencies,
	findDirectDependencyIssues,
} from './check-direct-dependencies';

const current = JSON.parse(
	readFileSync(new URL('../direct-dependency-policy.json', import.meta.url), 'utf8'),
);

function compactIssues(policy: unknown): string[] {
	return findDirectDependencyIssues(policy as never)
		.map(({ dependency, kind }) => `${dependency}:${kind}`)
		.sort();
}

describe('direct dependency usage policy', () => {
	test('matches the checked-in dependency debt exactly', () => {
		const policy = structuredClone(current);
		expect(compactIssues(policy)).toEqual([
			'@types/file-saver:orphan-type-direct',
			'@types/qrcode:type-package-in-runtime-dependencies',
			'file-saver:unused-runtime-direct',
			'jszip:unused-runtime-direct',
		].sort());
		expect(() => checkDirectDependencies(policy)).not.toThrow();
	});

	test('does not allow file-saver debt to disappear from policy while the package remains unused', () => {
		const policy = structuredClone(current);
		policy.knownDebt = policy.knownDebt.filter((entry: { dependency: string }) => entry.dependency !== 'file-saver');
		expect(() => checkDirectDependencies(policy)).toThrow('Direct dependency debt drifted');
	});

	test('requires the Preact renderer alias exception while source remains React-compatible', () => {
		const policy = structuredClone(current);
		policy.acceptedNonSourceRuntimeUse = [];
		expect(() => checkDirectDependencies(policy)).toThrow('Direct dependency debt drifted');
	});

	test('rejects stale manual debt after the named dependency no longer exists', () => {
		const policy = structuredClone(current);
		policy.knownDebt.push({
			packagePath: 'apps/extension-halo/package.json',
			section: 'devDependencies',
			dependency: '@types/nonexistent-nexus-debt',
			kind: 'orphan-type-direct',
			resolution: 'This synthetic debt must be rejected because the manifest does not contain it.',
		});
		expect(() => checkDirectDependencies(policy)).toThrow('Direct dependency debt drifted');
	});
});
