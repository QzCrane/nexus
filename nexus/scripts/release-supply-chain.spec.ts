import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	buildLicenseInventory,
	generateReleaseSupplyChainEvidence,
} from './release-supply-chain';

function sha256(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

describe('artifact-bound release supply-chain evidence', () => {
	test('labels the current external-package inventory as workspace-scoped, not artifact-scoped', () => {
		const inventory = buildLicenseInventory({
			components: [
				{
					'bom-ref': 'pkg:npm/z@2.0.0',
					name: 'z', version: '2.0.0', licenses: [{ expression: 'MIT' }],
					properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
				},
				{
					'bom-ref': 'pkg:npm/a@1.0.0',
					name: 'a', version: '1.0.0',
					properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
				},
				{
					'bom-ref': 'pkg:npm/internal@1.0.0',
					name: 'internal', version: '1.0.0',
					properties: [{ name: 'nexus:dependency-kind', value: 'workspace' }],
				},
			],
		});
		expect(inventory).toEqual({
			schemaVersion: 2,
			scope: 'workspace-installed-graph',
			artifactScoped: false,
			packages: [
				{ name: 'a', version: '1.0.0', license: 'UNKNOWN', bomRef: 'pkg:npm/a@1.0.0' },
				{ name: 'z', version: '2.0.0', license: 'MIT', bomRef: 'pkg:npm/z@2.0.0' },
			],
		});
	});

	test('binds ZIP, scoped SBOM/license evidence, product inputs and exact Git identity without modifying ZIP', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-supply-chain-'));
		try {
			const artifactPath = resolve(directory, 'halo.zip');
			const sbomPath = resolve(directory, 'nexus.cdx.json');
			const artifact = Buffer.from('exact-release-artifact');
			writeFileSync(artifactPath, artifact);
			writeFileSync(sbomPath, `${JSON.stringify({
				bomFormat: 'CycloneDX', specVersion: '1.6', components: [{
					'bom-ref': 'pkg:npm/example@1.0.0',
					name: 'example', version: '1.0.0', licenses: [{ expression: 'Apache-2.0' }],
					properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
				}],
			}, null, 2)}\n`);
			const result = generateReleaseSupplyChainEvidence({
				product: 'halo',
				artifactPath,
				sbomPath,
				recordedAt: '2026-08-18T00:00:00.000Z',
				identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
			});
			expect(readFileSync(artifactPath)).toEqual(artifact);
			expect(result.provenance).toMatchObject({
				schemaVersion: 2,
				product: 'halo',
				head: 'a'.repeat(40),
				tree: 'b'.repeat(40),
				artifact: { sha256: sha256(artifact), bytes: artifact.length },
				sbom: { scope: 'workspace-installed-graph', artifactScoped: false },
				licenses: {
					scope: 'workspace-installed-graph',
					artifactScoped: false,
					packages: 1,
					unknown: 0,
				},
				inputs: {
					workspaceLock: { path: 'nexus/bun.lock' },
					repositoryLock: { path: 'bun.lock' },
				},
			});
			expect(result.provenance.inputs.product.map(({ path }: { path: string }) => path)).toEqual([
				'nexus/apps/extension-halo/package.json',
				'nexus/apps/extension-halo/build.ts',
				'nexus/apps/extension-halo/public/manifest.json',
				'nexus/apps/extension-halo/release-admission.json',
				'nexus/apps/extension-halo/release-test-owners.json',
			]);
			expect(result.provenance.inputs.product.every(({ sha256: digest }: { sha256: string }) => /^[a-f0-9]{64}$/u.test(digest))).toBe(true);
			const licenses = JSON.parse(readFileSync(result.licensePath, 'utf8'));
			expect(licenses).toEqual({
				schemaVersion: 2,
				scope: 'workspace-installed-graph',
				artifactScoped: false,
				packages: [{
					name: 'example', version: '1.0.0', license: 'Apache-2.0', bomRef: 'pkg:npm/example@1.0.0',
				}],
			});
		} finally {
			rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});
