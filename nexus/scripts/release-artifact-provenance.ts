// goal: bind the final promoted/staged ZIP to whole-dist byte provenance and known non-npm derived-source provenance
// inv: byte provenance may be complete while authorship/legal provenance remains explicitly narrower

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	artifactProvenancePath,
	verifyStoredZipAgainstProvenance,
	type ArtifactProvenanceEvidence,
} from './artifact-provenance';
import { checkSourceDerivedThirdParty } from './check-source-derived-third-party';
import { generateReleaseSupplyChainEvidence } from './release-supply-chain';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const sourceDerivedPath = resolve(workspaceDir, 'source-derived-third-party.json');

interface SourceDerivedPolicy {
	schemaVersion: 1;
	entries: Array<{
		product: 'halo' | 'spectra';
		id: string;
		localPath: string;
		releaseEntry: string;
		upstreamRepository: string;
		upstreamCommit: string;
		upstreamFiles: string[];
		licenseExpression: string;
		noticePath: string;
	}>;
}

function sha256(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
	return sha256(readFileSync(path));
}

export interface FinalReleaseEvidenceFile {
	path: string;
	sha256: string;
	bytes: number;
}

export interface FinalReleaseEvidence {
	product: 'halo' | 'spectra';
	artifact: FinalReleaseEvidenceFile;
	licenses: FinalReleaseEvidenceFile;
	supplyChain: FinalReleaseEvidenceFile;
	wholeArtifact: FinalReleaseEvidenceFile;
}

function relativeRepo(path: string): string {
	return relative(repositoryRoot, path).replaceAll('\\', '/');
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function finalArtifactPath(product: 'halo' | 'spectra'): string {
	const extensionDir = resolve(workspaceDir, `apps/extension-${product}`);
	const pkg = readJson<{ version?: unknown }>(resolve(extensionDir, 'package.json'));
	if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pkg.version)) {
		throw new Error(`${product}: package version is not SemVer`);
	}
	return product === 'halo'
		? resolve(extensionDir, `release/.staging/halo-v${pkg.version}.zip`)
		: resolve(extensionDir, `release/spectra-v${pkg.version}.zip`);
}

export function buildReleaseArtifactAttestation({
	product,
	artifactPath,
	artifactProvenancePath: provenancePath,
	artifactProvenance,
	sourceDerivedPath: derivedPath,
	sourceDerived,
}: {
	product: 'halo' | 'spectra';
	artifactPath: string;
	artifactProvenancePath: string;
	artifactProvenance: ArtifactProvenanceEvidence;
	sourceDerivedPath: string;
	sourceDerived: SourceDerivedPolicy;
}) {
	if (artifactProvenance.product !== product || artifactProvenance.wholeArtifactScoped !== true) {
		throw new Error(`${product}: whole-artifact provenance does not belong to this product`);
	}
	if (sourceDerived.schemaVersion !== 1 || !Array.isArray(sourceDerived.entries)) {
		throw new Error('source-derived third-party policy is malformed');
	}
	const derivedOwners = sourceDerived.entries
		.filter((entry) => entry.product === product)
		.map((entry) => ({
			id: entry.id,
			localPath: entry.localPath,
			releaseEntry: entry.releaseEntry,
			upstreamRepository: entry.upstreamRepository,
			upstreamCommit: entry.upstreamCommit,
			upstreamFiles: [...entry.upstreamFiles],
			licenseExpression: entry.licenseExpression,
			noticePath: entry.noticePath,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	return {
		schemaVersion: 1,
		product,
		artifact: {
			path: relativeRepo(artifactPath),
			sha256: sha256File(artifactPath),
			bytes: readFileSync(artifactPath).byteLength,
		},
		wholeArtifact: {
			byteProvenanceScoped: true,
			staticAuthorshipScoped: false,
			reason: 'Every ZIP file/byte is mapped to a repository/build owner, but Git provenance alone cannot prove original authorship of every repository static asset.',
			provenancePath: relativeRepo(provenancePath),
			provenanceSha256: sha256File(provenancePath),
			files: artifactProvenance.files.length,
		},
		knownSourceDerivedThirdParty: {
			scoped: true,
			policyPath: relativeRepo(derivedPath),
			policySha256: sha256File(derivedPath),
			owners: derivedOwners,
		},
	};
}

export function generateReleaseArtifactAttestation(product: 'halo' | 'spectra'): string {
	const artifact = finalArtifactPath(product);
	const provenancePath = artifactProvenancePath(product);
	if (!existsSync(artifact)) throw new Error(`${product}: final artifact is missing`);
	if (!existsSync(provenancePath)) throw new Error(`${product}: whole-artifact provenance is missing`);
	if (!existsSync(sourceDerivedPath)) throw new Error('source-derived third-party policy is missing');
	checkSourceDerivedThirdParty();
	const provenance = readJson<ArtifactProvenanceEvidence>(provenancePath);
	verifyStoredZipAgainstProvenance({ product, artifactPath: artifact, evidence: provenance });
	const sourceDerived = readJson<SourceDerivedPolicy>(sourceDerivedPath);
	const attestation = buildReleaseArtifactAttestation({
		product,
		artifactPath: artifact,
		artifactProvenancePath: provenancePath,
		artifactProvenance: provenance,
		sourceDerivedPath,
		sourceDerived,
	});
	const output = `${artifact}.artifact-provenance.json`;
	writeFileSync(output, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
	console.log(`✓ ${product} final ZIP whole-artifact attestation: ${relativeRepo(output)}`);
	return output;
}

function evidenceFile(path: string): FinalReleaseEvidenceFile {
	return {
		path: relativeRepo(path),
		sha256: sha256File(path),
		bytes: readFileSync(path).byteLength,
	};
}

export function finalReleaseEvidencePaths(product: 'halo' | 'spectra') {
	const artifact = finalArtifactPath(product);
	return {
		artifact,
		licenses: `${artifact}.licenses.json`,
		supplyChain: `${artifact}.provenance.json`,
		wholeArtifact: `${artifact}.artifact-provenance.json`,
	};
}

export function readFinalReleaseEvidence(product: 'halo' | 'spectra'): FinalReleaseEvidence {
	const paths = finalReleaseEvidencePaths(product);
	for (const path of Object.values(paths)) {
		if (!existsSync(path)) throw new Error(`${product}: final release evidence is missing: ${relativeRepo(path)}`);
	}
	const artifact = evidenceFile(paths.artifact);
	const supplyChain = readJson<{
		schemaVersion?: unknown;
		product?: unknown;
		artifact?: { sha256?: unknown; bytes?: unknown };
		licenses?: { sha256?: unknown };
		wholeArtifactProvenance?: { sha256?: unknown };
	}>(paths.supplyChain);
	const wholeArtifact = readJson<{
		schemaVersion?: unknown;
		product?: unknown;
		artifact?: { sha256?: unknown; bytes?: unknown };
		wholeArtifact?: { provenanceSha256?: unknown };
	}>(paths.wholeArtifact);
	if (supplyChain.schemaVersion !== 5
		|| supplyChain.product !== product
		|| supplyChain.artifact?.sha256 !== artifact.sha256
		|| supplyChain.artifact?.bytes !== artifact.bytes
		|| supplyChain.licenses?.sha256 !== sha256File(paths.licenses)
		|| supplyChain.wholeArtifactProvenance?.sha256 !== wholeArtifact.wholeArtifact?.provenanceSha256
		|| wholeArtifact.schemaVersion !== 1
		|| wholeArtifact.product !== product
		|| wholeArtifact.artifact?.sha256 !== artifact.sha256
		|| wholeArtifact.artifact?.bytes !== artifact.bytes) {
		throw new Error(`${product}: final release evidence does not describe the current artifact and material chain`);
	}
	return {
		product,
		artifact,
		licenses: evidenceFile(paths.licenses),
		supplyChain: evidenceFile(paths.supplyChain),
		wholeArtifact: evidenceFile(paths.wholeArtifact),
	};
}

export function generateFinalReleaseEvidence(product: 'halo' | 'spectra'): FinalReleaseEvidence {
	const artifact = finalArtifactPath(product);
	generateReleaseSupplyChainEvidence({ product, artifactPath: artifact });
	generateReleaseArtifactAttestation(product);
	const evidence = readFinalReleaseEvidence(product);
	console.log(`✓ ${product} final release evidence: ${evidence.supplyChain.sha256}`);
	return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const product = process.argv[2];
	if (product !== 'halo' && product !== 'spectra') {
		throw new Error('usage: bun scripts/release-artifact-provenance.ts <halo|spectra>');
	}
	generateFinalReleaseEvidence(product);
}
