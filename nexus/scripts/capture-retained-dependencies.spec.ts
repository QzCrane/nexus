import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildRetainedDependencyEvidence } from './capture-retained-dependencies';

function fixturePackage(root: string, name: string, version: string, license = 'MIT'): string {
	const segments = name.startsWith('@') ? name.split('/') : [name];
	const directory = resolve(root, 'node_modules', ...segments);
	mkdirSync(directory, { recursive: true });
	writeFileSync(resolve(directory, 'package.json'), `${JSON.stringify({ name, version, license })}\n`);
	writeFileSync(resolve(directory, 'index.js'), 'export const value = 1;\n');
	return directory;
}

describe('product-retained npm dependency evidence', () => {
	test('aggregates only positive bytes physically retained from npm inputs', () => {
		const project = mkdtempSync(resolve(tmpdir(), 'nexus-retained-deps-'));
		try {
			fixturePackage(project, 'alpha', '1.2.3', 'Apache-2.0');
			fixturePackage(project, '@scope/beta', '4.5.6', 'MIT');
			const evidence = buildRetainedDependencyEvidence({
				product: 'spectra',
				projectDir: project,
				analysisSha256: 'a'.repeat(64),
				analysis: {
					outputs: {
						'a.js': { inputs: {
							'node_modules/alpha/index.js': { bytesInOutput: 30 },
							'node_modules/@scope/beta/index.js': { bytesInOutput: 12 },
							'src/local.ts': { bytesInOutput: 100 },
							'node_modules/alpha/tree-shaken.js': { bytesInOutput: 0 },
						} },
					},
					nested: [{ inputs: { 'node_modules/alpha/index.js': { bytesInOutput: 7 } } }],
				},
			});
			expect(evidence).toMatchObject({
				schemaVersion: 1,
				product: 'spectra',
				scope: 'product-retained-npm-runtime',
				npmArtifactScoped: true,
				wholeArtifactScoped: false,
			});
			expect(evidence.packages.map(({ name, version, license, bytesInOutput }) => ({
				name, version, license, bytesInOutput,
			}))).toEqual([
				{ name: '@scope/beta', version: '4.5.6', license: 'MIT', bytesInOutput: 12 },
				{ name: 'alpha', version: '1.2.3', license: 'Apache-2.0', bytesInOutput: 37 },
			]);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	test('fails closed when analysis has no positive retained input evidence', () => {
		const project = mkdtempSync(resolve(tmpdir(), 'nexus-retained-empty-'));
		try {
			expect(() => buildRetainedDependencyEvidence({
				product: 'halo',
				projectDir: project,
				analysisSha256: 'b'.repeat(64),
				analysis: { outputs: { 'sidepanel.js': { inputs: { 'src/local.ts': { bytesInOutput: 0 } } } } },
			})).toThrow('contains no retained input bytes');
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	test('rejects a non-exact analysis digest', () => {
		expect(() => buildRetainedDependencyEvidence({
			product: 'halo',
			projectDir: process.cwd(),
			analysisSha256: 'not-a-digest',
			analysis: {},
		})).toThrow('must be SHA-256');
	});
});
