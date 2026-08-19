// goal: derive the product-retained npm runtime closure from the exact production esbuild analysis
// inv: only source bytes retained in emitted JavaScript may become product-runtime dependency evidence

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);

interface InputDetail {
	bytesInOutput?: unknown;
}

interface PackageDocument {
	name?: unknown;
	version?: unknown;
	license?: unknown;
}

export interface RetainedPackage {
	name: string;
	version: string;
	license: string | null;
	bytesInOutput: number;
	inputs: string[];
}

export interface RetainedDependencyEvidence {
	schemaVersion: 1;
	product: 'halo' | 'spectra';
	scope: 'product-retained-npm-runtime';
	npmArtifactScoped: true;
	wholeArtifactScoped: false;
	analysisSha256: string;
	packages: RetainedPackage[];
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectRetainedInputBytes(value: unknown, totals = new Map<string, number>()): Map<string, number> {
	if (Array.isArray(value)) {
		for (const entry of value) collectRetainedInputBytes(entry, totals);
		return totals;
	}
	if (!isRecord(value)) return totals;
	for (const [key, nested] of Object.entries(value)) {
		if (key === 'inputs' && isRecord(nested)) {
			for (const [input, detail] of Object.entries(nested)) {
				if (!isRecord(detail)) continue;
				const bytes = (detail as InputDetail).bytesInOutput;
				if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) continue;
				totals.set(input, (totals.get(input) ?? 0) + bytes);
			}
			continue;
		}
		collectRetainedInputBytes(nested, totals);
	}
	return totals;
}

function pathContainsNodeModules(path: string): boolean {
	return path.split(/[\\/]/u).includes('node_modules');
}

function nearestPackageJson(inputPath: string, projectDir: string): string | null {
	if (!pathContainsNodeModules(inputPath)) return null;
	let current = dirname(resolve(projectDir, inputPath));
	const filesystemRoot = resolve(current, sep);
	while (current !== filesystemRoot) {
		const candidate = resolve(current, 'package.json');
		if (existsSync(candidate) && pathContainsNodeModules(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

function readPackageDocument(path: string): PackageDocument {
	return JSON.parse(readFileSync(path, 'utf8')) as PackageDocument;
}

function canonicalInput(input: string, projectDir: string): string {
	const absolute = resolve(projectDir, input);
	let physical = absolute;
	try {
		physical = realpathSync(absolute);
	} catch {
		// esbuild may report a symlink-facing path. The package identity is still
		// read from the nearest package.json below; evidence keeps a repo-relative
		// logical path instead of requiring the target to remain materialized.
	}
	const relativePhysical = relative(repositoryRoot, physical).replaceAll('\\', '/');
	return relativePhysical.startsWith('../')
		? input.replaceAll('\\', '/')
		: relativePhysical;
}

export function buildRetainedDependencyEvidence({
	product,
	analysis,
	analysisSha256,
	projectDir,
}: {
	product: 'halo' | 'spectra';
	analysis: unknown;
	analysisSha256: string;
	projectDir: string;
}): RetainedDependencyEvidence {
	if (!/^[a-f0-9]{64}$/u.test(analysisSha256)) throw new Error('retained dependency analysis digest must be SHA-256');
	const retained = collectRetainedInputBytes(analysis);
	if (retained.size === 0) throw new Error(`${product}: build analysis contains no retained input bytes`);

	const packages = new Map<string, {
		name: string;
		version: string;
		license: string | null;
		bytesInOutput: number;
		inputs: Set<string>;
	}>();
	for (const [input, bytes] of retained) {
		const packageJsonPath = nearestPackageJson(input, projectDir);
		if (!packageJsonPath) continue;
		const document = readPackageDocument(packageJsonPath);
		if (typeof document.name !== 'string' || !document.name
			|| typeof document.version !== 'string' || !document.version) {
			throw new Error(`${product}: retained npm input has invalid package metadata: ${input}`);
		}
		const id = `${document.name}@${document.version}`;
		const existing = packages.get(id) ?? {
			name: document.name,
			version: document.version,
			license: typeof document.license === 'string' && document.license.trim()
				? document.license.trim()
				: null,
			bytesInOutput: 0,
			inputs: new Set<string>(),
		};
		existing.bytesInOutput += bytes;
		existing.inputs.add(canonicalInput(input, projectDir));
		packages.set(id, existing);
	}

	const normalized: RetainedPackage[] = [...packages.values()]
		.map((entry) => ({
			name: entry.name,
			version: entry.version,
			license: entry.license,
			bytesInOutput: entry.bytesInOutput,
			inputs: [...entry.inputs].sort(),
		}))
		.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
	return {
		schemaVersion: 1,
		product,
		scope: 'product-retained-npm-runtime',
		npmArtifactScoped: true,
		wholeArtifactScoped: false,
		analysisSha256,
		packages: normalized,
	};
}

export function captureRetainedDependencies({
	product,
	analysisPath,
	outputPath,
	keepAnalysis = false,
}: {
	product: 'halo' | 'spectra';
	analysisPath?: string;
	outputPath?: string;
	keepAnalysis?: boolean;
}): string {
	const projectDir = resolve(workspaceDir, `apps/extension-${product}`);
	const source = resolve(analysisPath ?? resolve(projectDir, 'dist/build-analysis.json'));
	if (!existsSync(source)) throw new Error(`${product}: build analysis is missing: ${source}`);
	const output = resolve(outputPath ?? resolve(repositoryRoot, 'artifacts/supply-chain', `${product}.retained-dependencies.json`));
	const analysisSha256 = sha256File(source);
	const evidence = buildRetainedDependencyEvidence({
		product,
		analysis: JSON.parse(readFileSync(source, 'utf8')) as unknown,
		analysisSha256,
		projectDir,
	});
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	if (!keepAnalysis) rmSync(source, { force: true });
	console.log(
		`✓ ${product} retained npm runtime closure: ${evidence.packages.length} package(s) -> ${relative(repositoryRoot, output).replaceAll('\\', '/')}`,
	);
	return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const product = process.argv[2];
	if (product !== 'halo' && product !== 'spectra') {
		throw new Error('usage: bun scripts/capture-retained-dependencies.ts <halo|spectra> [--keep-analysis]');
	}
	const unknown = process.argv.slice(3).filter((arg) => arg !== '--keep-analysis');
	if (unknown.length > 0) throw new Error(`unknown retained-dependency option(s): ${unknown.join(', ')}`);
	captureRetainedDependencies({ product, keepAnalysis: process.argv.includes('--keep-analysis') });
}
