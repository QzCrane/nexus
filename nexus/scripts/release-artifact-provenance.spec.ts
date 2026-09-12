import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { ArtifactProvenanceEvidence } from './artifact-provenance';
import {
	buildReleaseArtifactAttestation,
	finalReleaseEvidencePaths,
} from './release-artifact-provenance';

function provenance(product: 'halo' | 'spectra'): ArtifactProvenanceEvidence {
	return {
		schemaVersion: 1,
		product,
		scope: 'whole-extension-dist',
		wholeArtifactScoped: true,
		analysisSha256: 'a'.repeat(64),
		files: [{
			path: 'background.js',
			sha256: 'b'.repeat(64),
			bytes: 10,
			origin: { kind: 'generated-bundle', owner: `nexus/apps/extension-${product}/build.ts`, entryPoint: 'src/background.ts' },
		}],
	};
}

describe('final release whole-artifact attestation', () => {
	test('owns the consumer-visible final sidecar paths beside each release ZIP', () => {
		for (const product of ['halo', 'spectra'] as const) {
			const paths = finalReleaseEvidencePaths(product);
			expect(paths.licenses).toBe(`${paths.artifact}.licenses.json`);
			expect(paths.supplyChain).toBe(`${paths.artifact}.provenance.json`);
			expect(paths.wholeArtifact).toBe(`${paths.artifact}.artifact-provenance.json`);
		}
	});

	test('keeps byte provenance complete without pretending repository authorship is proven', () => {
		const dir = mkdtempSync(resolve(tmpdir(), 'nexus-artifact-attestation-'));
		try {
			const artifact = resolve(dir, 'halo.zip');
			const provenancePath = resolve(dir, 'halo.provenance.json');
			const sourceDerivedPath = resolve(dir, 'source-derived.json');
			writeFileSync(artifact, 'artifact');
			writeFileSync(provenancePath, JSON.stringify(provenance('halo')));
			writeFileSync(sourceDerivedPath, JSON.stringify({ schemaVersion: 1, entries: [] }));
			const document = buildReleaseArtifactAttestation({
				product: 'halo',
				artifactPath: artifact,
				artifactProvenancePath: provenancePath,
				artifactProvenance: provenance('halo'),
				sourceDerivedPath,
				sourceDerived: {
					schemaVersion: 1,
					entries: [{
						product: 'halo',
						id: 'derived',
						localPath: 'apps/extension-halo/src/scripts/derived/script.js',
						releaseEntry: 'scripts/derived/script.js',
						upstreamRepository: 'https://github.com/example/upstream',
						upstreamCommit: 'c'.repeat(40),
						upstreamFiles: ['script.js'],
						licenseExpression: 'MIT',
						noticePath: 'apps/extension-halo/public/THIRD_PARTY_NOTICES.txt',
					}],
				},
			});
			expect(document).toMatchObject({
				schemaVersion: 1,
				product: 'halo',
				wholeArtifact: {
					byteProvenanceScoped: true,
					staticAuthorshipScoped: false,
					files: 1,
				},
				knownSourceDerivedThirdParty: {
					scoped: true,
					owners: [{ id: 'derived', licenseExpression: 'MIT' }],
				},
			});
		} finally {
			rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('rejects provenance owned by a different product', () => {
		const dir = mkdtempSync(resolve(tmpdir(), 'nexus-artifact-attestation-product-'));
		try {
			const artifact = resolve(dir, 'halo.zip');
			const provenancePath = resolve(dir, 'p.json');
			const sourceDerivedPath = resolve(dir, 's.json');
			writeFileSync(artifact, 'artifact');
			writeFileSync(provenancePath, '{}');
			writeFileSync(sourceDerivedPath, '{}');
			expect(() => buildReleaseArtifactAttestation({
				product: 'halo',
				artifactPath: artifact,
				artifactProvenancePath: provenancePath,
				artifactProvenance: provenance('spectra'),
				sourceDerivedPath,
				sourceDerived: { schemaVersion: 1, entries: [] },
			})).toThrow('does not belong to this product');
		} finally {
			rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});
});
