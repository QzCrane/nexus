import { describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildArtifactProvenance,
	normalizeBuildOutputIdentity,
	readStoredZipEntries,
	verifyArtifactProvenance,
	verifyStoredZipAgainstProvenance,
} from './artifact-provenance';
import { createStoredArchive } from '../apps/extension-spectra/scripts/create-release';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));

function tempDist(prefix: string): string {
	const root = mkdtempSync(resolve(tmpdir(), prefix));
	const dist = resolve(root, 'dist');
	mkdirSync(dist, { recursive: true });
	return dist;
}

describe('whole extension artifact provenance', () => {
	test('normalizes relative, Unix absolute, and Windows absolute esbuild output identities', () => {
		for (const input of [
			'background.js',
			'dist/background.js',
			'/workspace/nexus/apps/extension-spectra/dist/background.js',
			'C:\\workspace\\nexus\\apps\\extension-spectra\\dist\\background.js',
		]) {
			expect(normalizeBuildOutputIdentity(input), input).toBe('background.js');
		}
		expect(normalizeBuildOutputIdentity('/tmp/dist-cache/dist/chunks/popup.js'))
			.toBe('chunks/popup.js');
	});

	test('classifies repository static files and generated bundles without guessing', () => {
		const dist = tempDist('nexus-artifact-provenance-');
		try {
			writeFileSync(
				resolve(dist, 'manifest.json'),
				readFileSync(resolve(workspaceDir, 'apps/extension-halo/public/manifest.json')),
			);
			writeFileSync(resolve(dist, 'background.js'), 'export const runtime = true;\n');
			const evidence = buildArtifactProvenance({
				product: 'halo',
				distDir: dist,
				analysisSha256: 'a'.repeat(64),
				analysis: {
					entries: [{ outputs: {
						'background.js': { entryPoint: 'src/entry/background.ts', inputs: {} },
					} }],
				},
			});
			expect(evidence).toMatchObject({
				schemaVersion: 1,
				product: 'halo',
				scope: 'whole-extension-dist',
				wholeArtifactScoped: true,
			});
			expect(evidence.files.map(({ path, origin }) => ({ path, kind: origin.kind }))).toEqual([
				{ path: 'background.js', kind: 'generated-bundle' },
				{ path: 'manifest.json', kind: 'repository-static' },
			]);
			expect(evidence.files.find(({ path }) => path === 'background.js')?.origin.entryPoint)
				.toBe('src/entry/background.ts');
			expect(() => verifyArtifactProvenance({ product: 'halo', distDir: dist, evidence })).not.toThrow();
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});

	test('distinguishes declared SPECTRA build transforms from unexplained public-file mutation', () => {
		const dist = tempDist('nexus-artifact-transform-');
		try {
			const sourceManifest = JSON.parse(readFileSync(
				resolve(workspaceDir, 'apps/extension-spectra/public/manifest.json'),
				'utf8',
			)) as Record<string, unknown>;
			writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify({ ...sourceManifest, version: '9.9.9' }));
			writeFileSync(resolve(dist, 'background.js'), 'export {};\n');
			const evidence = buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'f'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			});
			expect(evidence.files.find(({ path }) => path === 'manifest.json')?.origin)
				.toMatchObject({
					kind: 'transformed-static',
					owner: 'nexus/apps/extension-spectra/build.ts',
				});

			writeFileSync(
				resolve(dist, 'accessibility.css'),
				`${readFileSync(resolve(workspaceDir, 'apps/extension-spectra/public/accessibility.css'), 'utf8')}\n/* unexplained */\n`,
			);
			expect(() => buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'f'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			})).toThrow('public release file changed without an explicit build transformer: accessibility.css');
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});

	test('recognizes deterministic SPECTRA i18n metadata generation', () => {
		const dist = tempDist('nexus-artifact-i18n-');
		try {
			mkdirSync(resolve(dist, 'i18n'), { recursive: true });
			writeFileSync(resolve(dist, 'i18n/en-US.json.gz'), Buffer.from([1, 2, 3]));
			writeFileSync(resolve(dist, 'background.js'), 'export {};\n');
			const evidence = buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'b'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			});
			expect(evidence.files.find(({ path }) => path === 'i18n/en-US.json.gz')?.origin)
				.toMatchObject({ kind: 'generated-metadata', owner: 'nexus/apps/extension-spectra/scripts/i18n-assets.ts' });
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});

	test('fails closed on an unowned release file', () => {
		const dist = tempDist('nexus-artifact-unknown-');
		try {
			writeFileSync(resolve(dist, 'background.js'), 'export {};\n');
			writeFileSync(resolve(dist, 'mystery.bin'), 'unknown-origin');
			expect(() => buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'c'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			})).toThrow('has no explicit provenance owner: mystery.bin');
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});

	test('detects both byte mutation and unrecorded additions after capture', () => {
		const dist = tempDist('nexus-artifact-drift-');
		try {
			writeFileSync(resolve(dist, 'background.js'), 'export const one = 1;\n');
			const evidence = buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'd'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			});
			writeFileSync(resolve(dist, 'background.js'), 'export const two = 2;\n');
			expect(() => verifyArtifactProvenance({ product: 'spectra', distDir: dist, evidence }))
				.toThrow('dist changed after whole-artifact provenance capture');
			writeFileSync(resolve(dist, 'extra.js'), 'extra');
			expect(() => verifyArtifactProvenance({ product: 'spectra', distDir: dist, evidence }))
				.toThrow('unrecorded release file extra.js');
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});

	test('binds local headers, central directory, EOCD, and payload bytes to one STORED ZIP identity', () => {
		const dist = tempDist('nexus-artifact-zip-');
		try {
			const background = Buffer.from('export const value = 1;\n');
			const manifest = readFileSync(resolve(workspaceDir, 'apps/extension-spectra/public/manifest.json'));
			writeFileSync(resolve(dist, 'background.js'), background);
			writeFileSync(resolve(dist, 'manifest.json'), manifest);
			const evidence = buildArtifactProvenance({
				product: 'spectra',
				distDir: dist,
				analysisSha256: 'e'.repeat(64),
				analysis: { outputs: { 'dist/background.js': { entryPoint: 'src/background/index.ts' } } },
			});
			const artifact = resolve(dirname(dist), 'spectra.zip');
			const pristine = createStoredArchive([
				{ name: 'manifest.json', data: manifest },
				{ name: 'background.js', data: background },
			]);
			writeFileSync(artifact, pristine);
			expect(readStoredZipEntries(artifact).map(({ path }) => path)).toEqual([
				'background.js',
				'manifest.json',
			]);
			expect(() => verifyStoredZipAgainstProvenance({
				product: 'spectra', artifactPath: artifact, evidence,
			})).not.toThrow();

			const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
			const centralOffset = pristine.indexOf(centralSignature);
			expect(centralOffset).toBeGreaterThanOrEqual(0);
			const centralTampered = Buffer.from(pristine);
			centralTampered[centralOffset + 16] = (centralTampered[centralOffset + 16] ?? 0) ^ 0xff;
			writeFileSync(artifact, centralTampered);
			expect(() => readStoredZipEntries(artifact)).toThrow('central directory disagrees with local entry');

			writeFileSync(artifact, Buffer.concat([pristine, Buffer.from([0])]));
			expect(() => readStoredZipEntries(artifact)).toThrow('trailing bytes after EOCD');

			writeFileSync(artifact, createStoredArchive([
				{ name: 'manifest.json', data: manifest },
				{ name: 'background.js', data: Buffer.from('tampered') },
			]));
			expect(() => verifyStoredZipAgainstProvenance({
				product: 'spectra', artifactPath: artifact, evidence,
			})).toThrow('final ZIP differs from whole-artifact provenance');
		} finally {
			rmSync(dirname(dist), { recursive: true, force: true });
		}
	});
});
