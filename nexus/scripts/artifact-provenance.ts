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
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;

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

export interface StoredZipEntryEvidence {
	path: string;
	sha256: string;
	bytes: number;
}

interface BuildOutputDetail {
	entryPoint?: unknown;
	inputs?: unknown;
}

interface LocalStoredZipEntry extends StoredZipEntryEvidence {
	crc32: number;
	localOffset: number;
	flags: number;
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

// esbuild metafile output keys vary by platform/invocation. Treat everything
// after the final physical dist boundary as the release identity so Windows
// absolute paths cannot disagree with Linux/relative builds.
export function normalizeBuildOutputIdentity(value: string): string {
	const normalized = normalizePath(value);
	if (normalized.startsWith('dist/')) return normalized.slice('dist/'.length);
	const marker = '/dist/';
	const boundary = normalized.lastIndexOf(marker);
	return boundary >= 0 ? normalized.slice(boundary + marker.length) : normalized;
}

function assertSafeArchivePath(path: string): void {
	if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
		throw new Error(`unsafe ZIP entry path: ${JSON.stringify(path)}`);
	}
	const segments = path.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new Error(`unsafe ZIP entry path: ${JSON.stringify(path)}`);
	}
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
				const normalized = normalizeBuildOutputIdentity(output);
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

function evidenceIdentity(files: readonly Pick<ArtifactFileEvidence, 'path' | 'sha256' | 'bytes'>[]): Array<{
	path: string;
	sha256: string;
	bytes: number;
}> {
	const seen = new Set<string>();
	return files.map(({ path, sha256, bytes }) => {
		assertSafeArchivePath(path);
		if (seen.has(path)) throw new Error(`artifact provenance repeats release path ${path}`);
		seen.add(path);
		if (!/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 0) {
			throw new Error(`artifact provenance has invalid file identity for ${path}`);
		}
		return { path, sha256, bytes };
	}).sort((left, right) => left.path.localeCompare(right.path));
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
	const recorded = new Map(evidence.files.map((entry) => [entry.path, entry]));
	if (recorded.size !== evidence.files.length) throw new Error(`${product}: artifact provenance repeats a release path`);
	const currentFiles = walkFiles(distDir).flatMap((file): ArtifactFileEvidence[] => {
		const relativePath = normalizePath(relative(distDir, file));
		if (relativePath === TEMP_ANALYSIS) return [];
		const entry = recorded.get(relativePath);
		if (!entry) throw new Error(`${product}: dist contains unrecorded release file ${relativePath}`);
		return [{ ...entry, sha256: sha256File(file), bytes: statSync(file).size }];
	});
	if (canonical(evidenceIdentity(currentFiles)) !== canonical(evidenceIdentity(evidence.files))) {
		throw new Error(`${product}: dist changed after whole-artifact provenance capture`);
	}
}

function readLocalStoredEntries(bytes: Buffer): { entries: LocalStoredZipEntry[]; centralOffset: number } {
	const entries: LocalStoredZipEntry[] = [];
	const names = new Set<string>();
	let offset = 0;
	while (offset + 4 <= bytes.length) {
		const signature = bytes.readUInt32LE(offset);
		if (signature === ZIP_CENTRAL_DIRECTORY_SIGNATURE) return { entries, centralOffset: offset };
		if (signature !== ZIP_LOCAL_FILE_SIGNATURE || offset + 30 > bytes.length) {
			throw new Error(`release ZIP has malformed local-file header at byte ${offset}`);
		}
		const flags = bytes.readUInt16LE(offset + 6);
		const method = bytes.readUInt16LE(offset + 8);
		const crc32 = bytes.readUInt32LE(offset + 14);
		const compressedSize = bytes.readUInt32LE(offset + 18);
		const uncompressedSize = bytes.readUInt32LE(offset + 22);
		const nameLength = bytes.readUInt16LE(offset + 26);
		const extraLength = bytes.readUInt16LE(offset + 28);
		if ((flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0) {
			throw new Error('release ZIP data descriptors are forbidden for deterministic provenance');
		}
		if ((flags & ~ZIP_UTF8_FLAG) !== 0) throw new Error('release ZIP contains unsupported local-file flags');
		if (method !== 0 || compressedSize !== uncompressedSize) {
			throw new Error('release ZIP provenance supports deterministic STORED entries only');
		}
		const nameStart = offset + 30;
		const dataStart = nameStart + nameLength + extraLength;
		const dataEnd = dataStart + compressedSize;
		if (nameLength === 0 || dataStart > bytes.length || dataEnd > bytes.length) {
			throw new Error(`release ZIP entry exceeds archive bounds at byte ${offset}`);
		}
		const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
		assertSafeArchivePath(name);
		if (names.has(name)) throw new Error(`release ZIP repeats entry path ${name}`);
		names.add(name);
		const data = bytes.subarray(dataStart, dataEnd);
		entries.push({
			path: name,
			sha256: sha256Bytes(data),
			bytes: data.length,
			crc32,
			localOffset: offset,
			flags,
		});
		offset = dataEnd;
	}
	throw new Error('release ZIP is missing central directory');
}

function verifyCentralDirectory(
	bytes: Buffer,
	localEntries: readonly LocalStoredZipEntry[],
	centralOffset: number,
): void {
	const byPath = new Map(localEntries.map((entry) => [entry.path, entry]));
	const seen = new Set<string>();
	let offset = centralOffset;
	while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
		if (offset + 46 > bytes.length) throw new Error('release ZIP central-directory header exceeds archive bounds');
		const flags = bytes.readUInt16LE(offset + 8);
		const method = bytes.readUInt16LE(offset + 10);
		const crc32 = bytes.readUInt32LE(offset + 16);
		const compressedSize = bytes.readUInt32LE(offset + 20);
		const uncompressedSize = bytes.readUInt32LE(offset + 24);
		const nameLength = bytes.readUInt16LE(offset + 28);
		const extraLength = bytes.readUInt16LE(offset + 30);
		const commentLength = bytes.readUInt16LE(offset + 32);
		const diskStart = bytes.readUInt16LE(offset + 34);
		const localOffset = bytes.readUInt32LE(offset + 42);
		if ((flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0 || (flags & ~ZIP_UTF8_FLAG) !== 0) {
			throw new Error('release ZIP contains unsupported central-directory flags');
		}
		if (method !== 0 || compressedSize !== uncompressedSize || diskStart !== 0) {
			throw new Error('release ZIP central directory violates deterministic STORED contract');
		}
		const nameStart = offset + 46;
		const next = nameStart + nameLength + extraLength + commentLength;
		if (nameLength === 0 || next > bytes.length) throw new Error('release ZIP central-directory entry exceeds archive bounds');
		const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
		assertSafeArchivePath(name);
		if (seen.has(name)) throw new Error(`release ZIP central directory repeats entry path ${name}`);
		seen.add(name);
		const local = byPath.get(name);
		if (!local
			|| local.flags !== flags
			|| local.crc32 !== crc32
			|| local.bytes !== uncompressedSize
			|| local.localOffset !== localOffset) {
			throw new Error(`release ZIP central directory disagrees with local entry ${name}`);
		}
		offset = next;
	}
	if (seen.size !== localEntries.length) {
		throw new Error(`release ZIP central directory count mismatch: local=${localEntries.length}, central=${seen.size}`);
	}
	if (offset + 22 > bytes.length || bytes.readUInt32LE(offset) !== ZIP_END_SIGNATURE) {
		throw new Error('release ZIP is missing EOCD immediately after central directory');
	}
	const diskNumber = bytes.readUInt16LE(offset + 4);
	const centralDisk = bytes.readUInt16LE(offset + 6);
	const entriesOnDisk = bytes.readUInt16LE(offset + 8);
	const totalEntries = bytes.readUInt16LE(offset + 10);
	const centralSize = bytes.readUInt32LE(offset + 12);
	const recordedCentralOffset = bytes.readUInt32LE(offset + 16);
	const commentLength = bytes.readUInt16LE(offset + 20);
	if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== localEntries.length
		|| totalEntries !== localEntries.length || recordedCentralOffset !== centralOffset
		|| centralSize !== offset - centralOffset || commentLength !== 0) {
		throw new Error('release ZIP EOCD disagrees with deterministic central directory');
	}
	if (offset + 22 !== bytes.length) throw new Error('release ZIP contains trailing bytes after EOCD');
}

export function readStoredZipEntries(path: string): StoredZipEntryEvidence[] {
	const bytes = readFileSync(path);
	const { entries, centralOffset } = readLocalStoredEntries(bytes);
	if (entries.length === 0) throw new Error('release ZIP has no local file entries');
	verifyCentralDirectory(bytes, entries, centralOffset);
	return entries
		.map(({ path: entryPath, sha256, bytes: entryBytes }) => ({ path: entryPath, sha256, bytes: entryBytes }))
		.sort((left, right) => left.path.localeCompare(right.path));
}

export function verifyStoredZipAgainstProvenance({
	product,
	artifactPath,
	evidence,
}: {
	product: 'halo' | 'spectra';
	artifactPath: string;
	evidence: ArtifactProvenanceEvidence;
}): void {
	if (evidence.product !== product || evidence.wholeArtifactScoped !== true) {
		throw new Error(`${product}: artifact provenance cannot validate this ZIP`);
	}
	const archive = readStoredZipEntries(artifactPath);
	const expected = evidenceIdentity(evidence.files);
	if (canonical(archive) !== canonical(expected)) {
		throw new Error(`${product}: final ZIP differs from whole-artifact provenance`);
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
