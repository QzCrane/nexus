import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	buildLicenseInventory,
	buildProductLicenseInventory,
	generateReleaseSupplyChainEvidence,
	parseLicenseAdjudicationPolicy,
} from './release-supply-chain';

function sha256(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function fixtureSbom() {
	return {
		bomFormat: 'CycloneDX', specVersion: '1.6', components: [{
			'bom-ref': 'pkg:npm/example@1.0.0',
			name: 'example', version: '1.0.0', licenses: [{ expression: 'Apache-2.0' }],
			properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
		}, {
			'bom-ref': 'pkg:npm/dev-only@9.0.0',
			name: 'dev-only', version: '9.0.0', licenses: [{ expression: 'MIT' }],
			properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
		}],
	};
}

function fixtureRetained(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		product: 'halo',
		scope: 'product-retained-npm-runtime',
		npmArtifactScoped: true,
		wholeArtifactScoped: false,
		analysisSha256: 'c'.repeat(64),
		packages: [{
			name: 'example',
			version: '1.0.0',
			license: 'Apache-2.0',
			bytesInOutput: 123,
			inputs: ['node_modules/example/index.js'],
		}],
		...overrides,
	};
}

function emptyAdjudication() {
	return {
		schemaVersion: 1,
		policy: 'A retained runtime package without machine-readable license metadata requires exact name/version review, a concrete license expression, an HTTPS source, and a durable rationale before release.',
		unknownLicenses: [],
	};
}

describe('artifact-bound release supply-chain evidence', () => {
	test('keeps the complete installed inventory explicitly workspace-scoped', () => {
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

	test('filters product licenses to exact npm packages physically retained in the build', () => {
		const inventory = buildProductLicenseInventory('halo', fixtureSbom(), fixtureRetained(), emptyAdjudication());
		expect(inventory).toEqual({
			schemaVersion: 4,
			scope: 'product-retained-npm-runtime',
			npmArtifactScoped: true,
			wholeArtifactScoped: false,
			packages: [{
				name: 'example',
				version: '1.0.0',
				license: 'Apache-2.0',
				licenseSource: 'package-metadata',
				bomRef: 'pkg:npm/example@1.0.0',
				bytesInOutput: 123,
			}],
		});
	});

	test('fails closed on retained package/version/license drift from the exact SBOM', () => {
		expect(() => buildProductLicenseInventory('halo', fixtureSbom(), fixtureRetained({
			packages: [{
				name: 'missing', version: '1.0.0', license: 'MIT', bytesInOutput: 1, inputs: ['x'],
			}],
		}), emptyAdjudication())).toThrow('absent from the exact installed SBOM');
		expect(() => buildProductLicenseInventory('halo', fixtureSbom(), fixtureRetained({
			packages: [{
				name: 'example', version: '2.0.0', license: 'Apache-2.0', bytesInOutput: 1, inputs: ['x'],
			}],
		}), emptyAdjudication())).toThrow('absent from the exact installed SBOM');
		expect(() => buildProductLicenseInventory('halo', fixtureSbom(), fixtureRetained({
			packages: [{
				name: 'example', version: '1.0.0', license: 'MIT', bytesInOutput: 1, inputs: ['x'],
			}],
		}), emptyAdjudication())).toThrow('license drift');
	});

	test('requires exact adjudication for UNKNOWN retained licenses and rejects stale exceptions', () => {
		const unknownSbom = {
			components: [{
				'bom-ref': 'pkg:npm/unknown-license@1.2.3',
				name: 'unknown-license', version: '1.2.3',
				properties: [{ name: 'nexus:dependency-kind', value: 'external' }],
			}],
		};
		const retained = fixtureRetained({
			packages: [{
				name: 'unknown-license', version: '1.2.3', license: null, bytesInOutput: 9, inputs: ['node_modules/unknown-license/index.js'],
			}],
		});
		expect(() => buildProductLicenseInventory('halo', unknownSbom, retained, emptyAdjudication()))
			.toThrow('UNKNOWN license and no exact adjudication');

		const adjudication = {
			...emptyAdjudication(),
			unknownLicenses: [{
				name: 'unknown-license',
				version: '1.2.3',
				licenseExpression: 'MIT',
				source: 'https://example.com/unknown-license/LICENSE',
				reason: 'Reviewed the exact 1.2.3 source archive and matched its bundled LICENSE text to the MIT license.',
			}],
		};
		expect(buildProductLicenseInventory('halo', unknownSbom, retained, adjudication).packages[0]).toMatchObject({
			license: 'MIT',
			licenseSource: 'adjudication',
			adjudicationSource: 'https://example.com/unknown-license/LICENSE',
		});

		expect(() => buildProductLicenseInventory('halo', fixtureSbom(), fixtureRetained(), {
			...emptyAdjudication(),
			unknownLicenses: [{
				name: 'example', version: '1.0.0', licenseExpression: 'Apache-2.0',
				source: 'https://example.com/LICENSE',
				reason: 'This deliberately stale adjudication must be rejected once installed metadata declares the license explicitly.',
			}],
		})).toThrow('adjudication for example@1.0.0 is stale');
	});

	test('rejects wildcard or weak adjudication records before they can become release exceptions', () => {
		expect(() => parseLicenseAdjudicationPolicy({
			...emptyAdjudication(),
			unknownLicenses: [{
				name: 'example*', version: '1.0.0', licenseExpression: 'MIT', source: 'https://example.com/LICENSE',
				reason: 'Wildcard package identities are not acceptable for exact supply-chain adjudication records.',
			}],
		})).toThrow('exact name/version');
	});

	test('binds ZIP, retained npm license evidence, product inputs and exact Git identity without modifying ZIP', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-supply-chain-'));
		try {
			const artifactPath = resolve(directory, 'halo.zip');
			const sbomPath = resolve(directory, 'nexus.cdx.json');
			const retainedPath = resolve(directory, 'halo.retained-dependencies.json');
			const adjudicationPath = resolve(directory, 'license-adjudication.json');
			const artifact = Buffer.from('exact-release-artifact');
			writeFileSync(artifactPath, artifact);
			writeFileSync(sbomPath, `${JSON.stringify(fixtureSbom(), null, 2)}\n`);
			writeFileSync(retainedPath, `${JSON.stringify(fixtureRetained(), null, 2)}\n`);
			writeFileSync(adjudicationPath, `${JSON.stringify(emptyAdjudication(), null, 2)}\n`);
			const result = generateReleaseSupplyChainEvidence({
				product: 'halo',
				artifactPath,
				sbomPath,
				retainedPath,
				licenseAdjudicationPath: adjudicationPath,
				recordedAt: '2026-08-18T00:00:00.000Z',
				identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
			});
			expect(readFileSync(artifactPath)).toEqual(artifact);
			expect(result.provenance).toMatchObject({
				schemaVersion: 4,
				product: 'halo',
				head: 'a'.repeat(40),
				tree: 'b'.repeat(40),
				artifact: { sha256: sha256(artifact), bytes: artifact.length },
				sbom: { scope: 'workspace-installed-graph', artifactScoped: false },
				retainedDependencies: {
					scope: 'product-retained-npm-runtime',
					npmArtifactScoped: true,
					wholeArtifactScoped: false,
					packages: 1,
				},
				licenses: {
					scope: 'product-retained-npm-runtime',
					npmArtifactScoped: true,
					wholeArtifactScoped: false,
					packages: 1,
					adjudicated: 0,
					unknown: 0,
				},
				inputs: {
					workspaceLock: { path: 'nexus/bun.lock' },
					repositoryLock: { path: 'bun.lock' },
				},
			});
			expect(result.provenance.retainedDependencies.sha256).toBe(sha256(readFileSync(retainedPath)));
			expect(result.provenance.inputs.licenseAdjudication.sha256).toBe(sha256(readFileSync(adjudicationPath)));
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
				schemaVersion: 4,
				scope: 'product-retained-npm-runtime',
				npmArtifactScoped: true,
				wholeArtifactScoped: false,
				packages: [{
					name: 'example', version: '1.0.0', license: 'Apache-2.0', licenseSource: 'package-metadata',
					bomRef: 'pkg:npm/example@1.0.0', bytesInOutput: 123,
				}],
			});
		} finally {
			rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});
