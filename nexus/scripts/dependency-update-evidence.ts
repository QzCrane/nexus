// goal: compare one fixed dependency-update workload across exact base/candidate product artifacts
// inv: metric coverage is exact to runtime-performance-policy; baseline phase reports deltas without inventing promotion thresholds

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductArtifactFile, ProductArtifactSnapshot } from './product-artifact-snapshot';
import type { RuntimePerformanceSummary } from './runtime-performance';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const performancePolicyPath = resolve(workspaceDir, 'runtime-performance-policy.json');

interface RuntimePerformanceEvidence {
	schemaVersion: 1;
	product: 'halo' | 'spectra';
	head: string;
	tree: string;
	host: {
		bun: string;
		browser: { name: string; version: string };
	};
	metrics: RuntimePerformanceSummary[];
}

interface RuntimePerformancePolicy {
	schemaVersion: 1;
	phase: 'baseline' | 'budgeted';
	minimumSamplesPerMetric: number;
	products: Record<'halo' | 'spectra', {
		workloads: Array<{ metrics: string[] }>;
	}>;
}

interface LoadedEvidenceSide {
	head: string;
	tree: string;
	artifacts: Record<'halo' | 'spectra', ProductArtifactSnapshot>;
	performance: Map<string, RuntimePerformanceEvidence & { summary: RuntimePerformanceSummary }>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function exactSha(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function collectJsonFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory()
			? collectJsonFiles(path)
			: entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
	}).sort();
}

function expectedMetrics(policy: RuntimePerformancePolicy): Map<string, 'halo' | 'spectra'> {
	const metrics = new Map<string, 'halo' | 'spectra'>();
	for (const product of ['halo', 'spectra'] as const) {
		for (const workload of policy.products[product].workloads) {
			for (const metric of workload.metrics) {
				if (metrics.has(metric)) throw new Error(`runtime performance policy duplicates metric ${metric}`);
				metrics.set(metric, product);
			}
		}
	}
	return metrics;
}

function validateArtifactSnapshot(
	value: ProductArtifactSnapshot,
	product: 'halo' | 'spectra',
): ProductArtifactSnapshot {
	if (value.schemaVersion !== 1 || value.product !== product || !exactSha(value.head) || !exactSha(value.tree)
		|| !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || !Array.isArray(value.files)) {
		throw new Error(`${product}: artifact snapshot is malformed`);
	}
	let total = 0;
	const paths = new Set<string>();
	for (const file of value.files) {
		if (!file || typeof file.path !== 'string' || !file.path || paths.has(file.path)
			|| !Number.isSafeInteger(file.bytes) || file.bytes < 0
			|| typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
			throw new Error(`${product}: artifact snapshot file entry is malformed or duplicated`);
		}
		paths.add(file.path);
		total += file.bytes;
	}
	if (total !== value.totalBytes) throw new Error(`${product}: artifact snapshot totalBytes drifted`);
	return value;
}

function loadSide(
	root: string,
	policy: RuntimePerformancePolicy,
): LoadedEvidenceSide {
	const artifacts = {
		halo: validateArtifactSnapshot(readJson<ProductArtifactSnapshot>(resolve(root, 'artifact-halo.json')), 'halo'),
		spectra: validateArtifactSnapshot(readJson<ProductArtifactSnapshot>(resolve(root, 'artifact-spectra.json')), 'spectra'),
	};
	if (artifacts.halo.head !== artifacts.spectra.head || artifacts.halo.tree !== artifacts.spectra.tree) {
		throw new Error('HALO and SPECTRA artifact snapshots do not share one measured Git identity');
	}
	const head = artifacts.halo.head;
	const tree = artifacts.halo.tree;
	const expected = expectedMetrics(policy);
	const performance = new Map<string, RuntimePerformanceEvidence & { summary: RuntimePerformanceSummary }>();
	const files = collectJsonFiles(resolve(root, 'performance'));
	if (files.length === 0) throw new Error(`dependency performance evidence is missing under ${root}`);
	for (const path of files) {
		const document = readJson<RuntimePerformanceEvidence>(path);
		if (document.schemaVersion !== 1 || (document.product !== 'halo' && document.product !== 'spectra')
			|| document.head !== head || document.tree !== tree || !Array.isArray(document.metrics)
			|| typeof document.host?.bun !== 'string' || typeof document.host?.browser?.version !== 'string') {
			throw new Error(`runtime performance evidence is malformed or bound to the wrong artifact identity: ${path}`);
		}
		for (const summary of document.metrics) {
			const owner = expected.get(summary.metric);
			if (!owner) throw new Error(`runtime performance evidence contains unowned metric ${summary.metric}`);
			if (owner !== document.product) throw new Error(`${summary.metric}: performance evidence came from wrong product ${document.product}`);
			if (performance.has(summary.metric)) throw new Error(`runtime performance evidence duplicates metric ${summary.metric}`);
			if (summary.count < policy.minimumSamplesPerMetric) {
				throw new Error(`${summary.metric}: performance evidence has only ${summary.count} samples`);
			}
			performance.set(summary.metric, { ...document, summary });
		}
	}
	const missing = [...expected.keys()].filter((metric) => !performance.has(metric));
	if (missing.length > 0) throw new Error(`dependency performance evidence omitted policy metrics: ${missing.join(', ')}`);
	if (performance.size !== expected.size) throw new Error('dependency performance metric coverage is not exact');
	return { head, tree, artifacts, performance };
}

function fileMap(files: ProductArtifactFile[]): Map<string, ProductArtifactFile> {
	return new Map(files.map((file) => [file.path, file]));
}

function artifactDelta(base: ProductArtifactSnapshot, candidate: ProductArtifactSnapshot) {
	const before = fileMap(base.files);
	const after = fileMap(candidate.files);
	const added = [...after.values()].filter((file) => !before.has(file.path));
	const removed = [...before.values()].filter((file) => !after.has(file.path));
	const changed = [...after.values()].flatMap((file) => {
		const previous = before.get(file.path);
		if (!previous || previous.sha256 === file.sha256 && previous.bytes === file.bytes) return [];
		return [{
			path: file.path,
			baseBytes: previous.bytes,
			candidateBytes: file.bytes,
			deltaBytes: file.bytes - previous.bytes,
			baseSha256: previous.sha256,
			candidateSha256: file.sha256,
		}];
	});
	return {
		baseBytes: base.totalBytes,
		candidateBytes: candidate.totalBytes,
		deltaBytes: candidate.totalBytes - base.totalBytes,
		added: added.sort((left, right) => left.path.localeCompare(right.path)),
		removed: removed.sort((left, right) => left.path.localeCompare(right.path)),
		changed: changed.sort((left, right) => left.path.localeCompare(right.path)),
		unchangedFiles: base.files.length - removed.length - changed.length,
	};
}

function numericDelta(base: number, candidate: number) {
	const absolute = Number((candidate - base).toFixed(3));
	return {
		base,
		candidate,
		absolute,
		percent: base === 0 ? null : Number((absolute / base * 100).toFixed(3)),
	};
}

function performanceDelta(
	base: LoadedEvidenceSide,
	candidate: LoadedEvidenceSide,
	policy: RuntimePerformancePolicy,
) {
	return [...expectedMetrics(policy)].sort(([left], [right]) => left.localeCompare(right)).map(([metric, product]) => {
		const before = base.performance.get(metric);
		const after = candidate.performance.get(metric);
		if (!before || !after) throw new Error(`${metric}: missing comparison evidence`);
		if (before.summary.unit !== after.summary.unit) throw new Error(`${metric}: unit changed across dependency comparison`);
		if (before.host.bun !== after.host.bun) throw new Error(`${metric}: Bun version changed inside one dependency comparison`);
		if (before.host.browser.version !== after.host.browser.version) {
			throw new Error(`${metric}: browser version changed inside one dependency comparison`);
		}
		return {
			metric,
			product,
			unit: before.summary.unit,
			count: { base: before.summary.count, candidate: after.summary.count },
			p50: numericDelta(before.summary.p50, after.summary.p50),
			p95: numericDelta(before.summary.p95, after.summary.p95),
			p99: numericDelta(before.summary.p99, after.summary.p99),
			mean: numericDelta(before.summary.mean, after.summary.mean),
		};
	});
}

export function buildDependencyUpdateEvidence({
	baseRoot,
	candidateRoot,
	policy = readJson<RuntimePerformancePolicy>(performancePolicyPath),
}: {
	baseRoot: string;
	candidateRoot: string;
	policy?: RuntimePerformancePolicy;
}) {
	if (policy.schemaVersion !== 1 || !Number.isInteger(policy.minimumSamplesPerMetric)
		|| policy.minimumSamplesPerMetric < 1 || (policy.phase !== 'baseline' && policy.phase !== 'budgeted')) {
		throw new Error('runtime performance policy is malformed for dependency comparison');
	}
	const base = loadSide(resolve(baseRoot), policy);
	const candidate = loadSide(resolve(candidateRoot), policy);
	if (base.head === candidate.head) throw new Error('dependency comparison base and candidate HEAD must differ');
	return {
		schemaVersion: 1,
		phase: policy.phase,
		decision: policy.phase === 'baseline' ? 'evidence-only-no-budget' : 'budget-evaluation-owned-elsewhere',
		base: { head: base.head, tree: base.tree },
		candidate: { head: candidate.head, tree: candidate.tree },
		artifacts: {
			halo: artifactDelta(base.artifacts.halo, candidate.artifacts.halo),
			spectra: artifactDelta(base.artifacts.spectra, candidate.artifacts.spectra),
		},
		performance: performanceDelta(base, candidate, policy),
	};
}

export function writeDependencyUpdateEvidence(options: Parameters<typeof buildDependencyUpdateEvidence>[0], outputPath: string): string {
	const evidence = buildDependencyUpdateEvidence(options);
	const path = resolve(outputPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [baseRoot, candidateRoot, outputPath] = process.argv.slice(2);
	if (!baseRoot || !candidateRoot || !outputPath) {
		throw new Error('usage: bun scripts/dependency-update-evidence.ts <base-evidence-dir> <candidate-evidence-dir> <output-json>');
	}
	console.log(`✓ Dependency update evidence: ${writeDependencyUpdateEvidence({ baseRoot, candidateRoot }, outputPath)}`);
}
