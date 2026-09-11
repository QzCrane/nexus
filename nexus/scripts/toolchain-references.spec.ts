import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { findBunVersionDrift, isCurrentToolchainFile, listArchiveToolchainFiles } from './toolchain-references';
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


describe('immutable source archive toolchain inventory', () => {
	test('scans hidden and nested owners without Git and excludes only generated or historical paths', () => {
		const root = mkdtempSync(join(tmpdir(), 'nexus-toolchain-archive-'));
		try {
			const owned = [
				'.github/workflows/check.yml', '.agents/skills/build/SKILL.md', 'AGENTS.md',
				'package.json', 'nexus/package.json', 'nexus/scripts/nested/build.ts',
				'nexus/docs/engineering/README.md', 'remote-site/source.mjs',
			];
			const ignored = [
				'nexus/node_modules/dependency/package.json', 'nexus/.turbo/state.json',
				'nexus/apps/extension-halo/dist/app.js', 'nexus/artifacts/prior.json',
				'nexus/apps/extension-halo/release/old.json', 'nexus/test-results/error.md',
				'nexus/docs/_archive/historical.md', 'bun.lock', 'nexus/public/icon.png',
			];
			for (const path of [...owned, ...ignored]) {
				const absolute = join(root, path);
				mkdirSync(dirname(absolute), { recursive: true });
				writeFileSync(absolute, `Bun ${old}`);
			}
			const files = listArchiveToolchainFiles(root);
			expect(files.map((path) => relative(root, path).replaceAll('\\', '/')).sort()).toEqual(owned.sort());
			expect(files.flatMap((path) => findBunVersionDrift(
				relative(root, path), readFileSync(path, 'utf8'), BUN_VERSION,
			))).toHaveLength(owned.length);
			expect(listArchiveToolchainFiles(root)).toEqual(files);
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});

	test('uses the same current-file predicate for Git and archive paths', () => {
		expect(isCurrentToolchainFile('.github/workflows/build.yml')).toBe(true);
		expect(isCurrentToolchainFile('nexus\\scripts\\build.ts')).toBe(true);
		expect(isCurrentToolchainFile('nexus/docs/_archive/old.md')).toBe(false);
		expect(isCurrentToolchainFile('nexus\\docs\\_archive\\old.md')).toBe(false);
		expect(isCurrentToolchainFile('bun.lock')).toBe(false);
		expect(isCurrentToolchainFile('nexus/public/icon.png')).toBe(false);
	});
});
