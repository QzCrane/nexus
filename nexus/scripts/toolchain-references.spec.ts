import { describe, expect, test } from 'bun:test';
import { findBunVersionDrift } from './toolchain-references';
import { BUN_VERSION } from './toolchain-versions';

const old = ['1', '3', '14'].join('.');
describe('current toolchain reference authority', () => {
	test('rejects stale package, script, workflow and live document pins', () => {
		for (const [path, text] of [
			['nexus/package.json', `"packageManager":"bun@${old}"`],
			['nexus/build.ts', `const BUN_VERSION = '${old}'`],
			['.github/workflows/check.yml', `bun-version: '${old}'`],
			['nexus/docs/engineering/README.md', `Use Bun ${old}`],
		]) expect(findBunVersionDrift(path, text, BUN_VERSION)).toHaveLength(1);
	});
	test('preserves historical source reasons without treating them as commands', () => {
		expect(findBunVersionDrift('nexus/integration-decisions.json', `rejected Bun ${old}`, BUN_VERSION)).toEqual([]);
		expect(findBunVersionDrift('nexus/docs/_archive/prior.md', `Bun ${old}`, BUN_VERSION)).toEqual([]);
		expect(findBunVersionDrift('nexus/other-decisions.json', `Bun ${old}`, BUN_VERSION)).toHaveLength(1);
	});
	test('accepts exact current references on repeated runs', () => {
		for (let i = 0; i < 2; i++) expect(findBunVersionDrift('nexus/package.json', `bun@${BUN_VERSION}`, BUN_VERSION)).toEqual([]);
	});
});
