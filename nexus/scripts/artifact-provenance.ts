// goal: bind every final extension dist file to an explicit repository/build origin
// inv: no release file may exist without a deterministic source/build owner

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const TEMP_ANALYSIS = 'build-analysis.json';

export type ArtifactOriginKind =
	| 'repository-static'
	| 'generated-bundle'
	| 'generated-metadata'
	| 'repository-runtime-copy';

export interface ArtifactOrigin {
	kind: ArtifactOriginKind;
	owner: string;
	sourceSha256?: string;
	entryPoint?: string | null;
}

export interface ArtifactFileEvidence {
	path: string;
	sha256: string;
	bytes: number;
	origin: ArtifactOrigin;
}

export interface ArtifactProvenanceEvidence {
	schemaVersion: 1;
	product: 'halo' | 'spectra';
	scope: 'whole-extension-dist';
	wholeArtifactScoped: true;
	analysisSha256: string;
	files: ArtifactFileEvidence[];
}

interface BuildOutputDetail {
	entryPoint?: unknown;
	inputs?: unknown;
}

function sha256Bytes(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
	return sha256Bytes(readFileSync(path));
}

function walkFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const candidate = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`artifact provenance forbids symlink: ${candidate}`);
		if (entry.isDirectory()) return walkFiles(candidate);
		if (!entry.isFile()) throw new Error(`artifact provenance found unsupported filesystem entry: ${candidate}`);
		return [candidate];
	}).sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function collectBuildOutputs(value: unknown, outputs = new Map<string, string | null>()): Map<string, string | null> {
	if (Array.isArray(value)) {
		for (const entry of value) collectBuildOutputs(entry, outputs);
		return outputs;
	}
	if (!isRecord(value)) return outputs;
	for (const [key, nested] of Object.entries(value)) {
		if (key === 'outputs' && isRecord(nested)) {
			for (const [output, detail] of Object.entries(nested)) {
				if (!isRecord(detail)) continue;
				const normalized = normalizePath(output).replace(/^dist\//u, '');
				const entryPoint = typeof (detail as BuildOutputDetail).entryPoint === 'string'
					? normalizePath((detail as { entryPoint: string }).entryPoint)
					: null;
				if (outputs.has(normalized) && outputs.get(normalized) !== entryPoint) {
					throw new Error(`build analysis assigns conflicting owners to ${normalized}`);
				}
				outputs.set(normalized, entryPoint);
			}
			continue;
		}
		collectBuildOutputs(nested, outputs);
	}
	return outputs;
}

function repositoryRelative(path: string): string {
	return relative(repositoryRoot, path).replaceAll('\\', '/');
}

function sourceOrigin(path: string, kind: ArtifactOriginKind): ArtifactOrigin {
	if (!existsSync(path)) throw new Error(`artifact source owner is missing: ${path}`);
	return {
		kind,
		owner: repositoryRelative(path),
		sourceSha256: sha256File(path),
	};
}

function haloRuntimeCopySource(projectDir: string, relativePath: string): string | null {
	const match = /^(tools|scripts)\/([^/]+)\/script\.css$/u.exec(relativePath);
	if (!match) return null;
	return resolve(projectDir, 'src', match[1] ?? '', match[2] ?? '', 'script.css');
}

function resolveOrigin({
	product,
	projectDir,
	relativePath,
	buildOutputs,
}: {
	product: 'halo' | 'spectra';
	projectDir: string;
	relativePath: string;
	buildOutputs: ReadonlyMap<string, string | null>;
}): ArtifactOrigin {
	const publicSource = resolve(projectDir, 'public', relativePath);
	if (existsSync(publicSource)) return sourceOrigin(publicSource, 'repository-static');

	const buildOwner = buildOutputs.get(relativePath);
	if (buildOwner !== undefined) {
		return {
			kind: 'generated-bundle',
			owner: repositoryRelative(resolve(projectDir, 'build.ts')),
			entryPoint: buildOwner,
		};
	}

	if (product === 'halo') {
		const copied = haloRuntimeCopySource(projectDir, relativePath);
		if (copied && existsSync(copied)) return sourceOrigin(copied, 'repository-runtime-copy');
	}

	if (product === 'spectra' && /^i18n\/[A-Za-z0-9-]+\.json\.gz$/u.test(relativePath)) {
		return sourceOrigin(resolve(projectDir, 'scripts/i18n-assets.ts'), 'generated-metadata');
	}

	throw new Error(`${product}: release artifact file has no explicit provenance owner: ${relativePath}`);
}

export function buildArtifactProvenance({
	product,
	distDir,
	analysis,
	analysisSha256,
}: {
	product: 'halo' | 'spectra';
	distDir: string;
	analysis: unknown;
	analysisSha256: string;
}): ArtifactProvenanceEvidence {
	if (!/^[a-f0-9]{64}$/u.test(analysisSha256)) {
		throw new Error('artifact provenance requires exact build-analysis SHA-256');
	}
	const projectDir = resolve(workspaceDir, `apps/extension-${product}`);
	const buildOutputs = collectBuildOutputs(analysis);
	if (buildOutputs.size === 0) throw new Error(`${product}: build analysis has no emitted outputs`);
	const files = walkFiles(distDir).flatMap((file): ArtifactFileEvidence[] => {
		const relativePath = normalizePath(relative(distDir, file));
		if (relativePath === TEMP_ANALYSIS) return [];
		return [{
			path: relativePath,
			sha256: sha256File(file),
			bytes: statSync(file).size,
			origin: resolveOrigin({ product, projectDir, relativePath, buildOutputs }),
		}];
	}).sort((left, right) => left.path.localeCompare(right.path));
	if (files.length === 0) throw new Error(`${product}: dist has no release files`);
	return {
		schemaVersion: 1,
		product,
		scope: 'whole-extension-dist',
		wholeArtifactScoped: true,
		analysisSha256,
		files,
	};
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function verifyArtifactProvenance({
	product,
	distDir,
	evidence,
}: {
	product: 'halo' | 'spectra';
	distDir: string;
	evidence: ArtifactProvenanceEvidence;
}): void {
	if (evidence.schemaVersion !== 1 || evidence.product !== product
		|| evidence.scope !== 'whole-extension-dist' || evidence.wholeArtifactScoped !== true) {
		throw new Error(`${product}: artifact provenance evidence is malformed`);
	}
	const currentFiles = walkFiles(distDir).flatMap((file): ArtifactFileEvidence[] => {
		const relativePath = normalizePath(relative(distDir, file));
		if (relativePath === TEMP_ANALYSIS) return [];
		const recorded = evidence.files.find((entry) => entry.path === relativePath);
		if (!recorded) throw new Error(`${product}: dist contains unrecorded release file ${relativePath}`);
		return [{ ...recorded, sha256: sha256File(file), bytes: statSync(file).size }];
	}).sort((left, right) => left.path.localeCompare(right.path));
	const recordedIdentity = evidence.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
	const currentIdentity = currentFiles.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
	if (canonical(currentIdentity) !== canonical(recordedIdentity)) {
		throw new Error(`${product}: dist changed after whole-artifact provenance capture`);
	}
}

export function artifactProvenancePath(product: 'halo' | 'spectra'): string {
	return resolve(repositoryRoot, 'artifacts/supply-chain', `${product}.artifact-provenance.json`);
}

export function captureArtifactProvenance({
	product,
	keepAnalysis = false,
}: {
	product: 'halo' | 'spectra';
	keepAnalysis?: boolean;
}): string {
	const projectDir = resolve(workspaceDir, `apps/extension-${product}`);
	const distDir = resolve(projectDir, 'dist');
	const analysisPath = resolve(distDir, TEMP_ANALYSIS);
	if (!existsSync(analysisPath)) throw new Error(`${product}: build-analysis.json is missing`);
	const analysisSha256 = sha256File(analysisPath);
	const evidence = buildArtifactProvenance({
		product,
		distDir,
		analysis: JSON.parse(readFileSync(analysisPath, 'utf8')) as unknown,
		analysisSha256,
	});
	const output = artifactProvenancePath(product);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	if (!keepAnalysis) rmSync(analysisPath, { force: true });
	console.log(`✓ ${product} whole-artifact provenance: ${evidence.files.length} file(s) -> ${repositoryRelative(output)}`);
	return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const product = process.argv[2];
	if (product !== 'halo' && product !== 'spectra') {
		throw new Error('usage: bun scripts/artifact-provenance.ts <halo|spectra> [--keep-analysis]');
	}
	const unknown = process.argv.slice(3).filter((arg) => arg !== '--keep-analysis');
	if (unknown.length > 0) throw new Error(`unknown artifact provenance option(s): ${unknown.join(', ')}`);
	captureArtifactProvenance({ product, keepAnalysis: process.argv.includes('--keep-analysis') });
}
