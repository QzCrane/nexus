import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkDirectDependencies, findDirectDependencyIssues, type PackageDocument } from './check-direct-dependencies';

const current = JSON.parse(readFileSync(new URL('../direct-dependency-policy.json', import.meta.url), 'utf8'));
const haloPath = 'apps/extension-halo/package.json';
const halo: PackageDocument = JSON.parse(readFileSync(new URL(`../${haloPath}`, import.meta.url), 'utf8'));
function withRuntime(dependency: string): Record<string, PackageDocument> {
	return { [haloPath]: { ...halo, dependencies: { ...halo.dependencies, [dependency]: '1.0.0' } } };
}

describe('direct dependency usage policy', () => {
	test('keeps the already-clean current main dependency graph instead of resurrecting old debt', () => {
		expect(findDirectDependencyIssues()).toEqual([]);
		expect(current.knownDebt).toEqual([]);
		expect(() => checkDirectDependencies()).not.toThrow();
	});
	test('discovers reintroduced unused runtime dependencies without a manual debt entry', () => {
		for (const name of ['file-saver', 'jszip']) {
			expect(findDirectDependencyIssues(current, withRuntime(name))).toContainEqual({
				packagePath: haloPath, section: 'dependencies', dependency: name, kind: 'unused-runtime-direct',
			});
			expect(() => checkDirectDependencies(current, withRuntime(name))).toThrow('Direct dependency debt drifted');
		}
	});
	test('requires evidence for the Preact renderer while source stays React-compatible', () => {
		const policy = structuredClone(current);
		policy.acceptedNonSourceRuntimeUse = [];
		expect(() => checkDirectDependencies(policy)).toThrow('Direct dependency debt drifted');
	});
	test('classifies source-only React and ReactDOM if reintroduced to production dependencies', () => {
		for (const name of ['react', 'react-dom']) {
			expect(findDirectDependencyIssues(current, withRuntime(name))).toContainEqual({
				packagePath: haloPath, section: 'dependencies', dependency: name, kind: 'source-import-not-shipped-runtime',
			});
			expect(() => checkDirectDependencies(current, withRuntime(name))).toThrow('Direct dependency debt drifted');
		}
	});
	test('discovers orphan type packages without depending on the debt register', () => {
		const overrides = { [haloPath]: { ...halo, devDependencies: { ...halo.devDependencies, '@types/file-saver': '2.0.7' } } };
		expect(findDirectDependencyIssues(current, overrides)).toContainEqual({
			packagePath: haloPath, section: 'devDependencies', dependency: '@types/file-saver', kind: 'orphan-type-direct',
		});
		expect(() => checkDirectDependencies(current, overrides)).toThrow('Direct dependency debt drifted');
	});
	test('rejects stale debt for packages already removed from the current lock graph', () => {
		const policy = structuredClone(current);
		policy.knownDebt.push({ packagePath: haloPath, section: 'dependencies', dependency: 'file-saver',
			kind: 'unused-runtime-direct', resolution: 'Historical debt cannot remain after the dependency was removed.' });
		expect(() => checkDirectDependencies(policy)).toThrow('Direct dependency debt drifted');
	});
	test('rejects type-only packages in the runtime dependency section', () => {
		expect(findDirectDependencyIssues(current, withRuntime('@types/qrcode'))).toContainEqual({
			packagePath: haloPath, section: 'dependencies', dependency: '@types/qrcode', kind: 'type-package-in-runtime-dependencies',
		});
	});
});
