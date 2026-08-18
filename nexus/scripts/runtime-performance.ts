// goal: Turn repeated browser-runtime measurements into exact-head p50/p95/p99 evidence.
// inv: finite non-negative samples, one unit per metric, >=20 samples for percentile evidence.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, platform, release as osRelease } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RuntimePerformanceSample {
	metric: string;
	value: number;
	unit: 'ms' | 'bytes' | 'count';
}

export interface RuntimePerformanceSummary {
	metric: string;
	unit: RuntimePerformanceSample['unit'];
	count: number;
	min: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	mean: number;
}

export interface RuntimePerformanceIdentity {
	head: string;
	tree: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const MIN_PERCENTILE_SAMPLES = 20;

function canonicalNumber(value: number): number {
	return Number(value.toFixed(3));
}

export function percentile(values: readonly number[], ratio: number): number {
	if (values.length === 0) throw new Error('percentile requires at least one value');
	if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('percentile ratio must be 0..1');
	const ordered = [...values].sort((left, right) => left - right);
	const rank = Math.max(1, Math.ceil(ratio * ordered.length));
	const value = ordered[rank - 1];
	if (value === undefined) throw new Error('percentile rank is invalid');
	return canonicalNumber(value);
}

export function summarizeRuntimePerformance(
	samples: readonly RuntimePerformanceSample[],
	minimumSamples = MIN_PERCENTILE_SAMPLES,
): RuntimePerformanceSummary[] {
	if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
		throw new Error('minimum performance sample count must be a positive integer');
	}
	const groups = new Map<string, RuntimePerformanceSample[]>();
	for (const sample of samples) {
		if (!sample.metric.trim()) throw new Error('performance metric name is empty');
		if (!Number.isFinite(sample.value) || sample.value < 0) {
			throw new Error(`performance sample ${sample.metric} must be finite and non-negative`);
		}
		const existing = groups.get(sample.metric) ?? [];
		if (existing[0] && existing[0].unit !== sample.unit) {
			throw new Error(`performance metric ${sample.metric} mixes units`);
		}
		existing.push(sample);
		groups.set(sample.metric, existing);
	}
	return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([metric, group]) => {
		if (group.length < minimumSamples) {
			throw new Error(`${metric} requires at least ${minimumSamples} samples, found ${group.length}`);
		}
		const values = group.map(({ value }) => value);
		const sum = values.reduce((total, value) => total + value, 0);
		return {
			metric,
			unit: group[0]?.unit ?? 'ms',
			count: group.length,
			min: canonicalNumber(Math.min(...values)),
			p50: percentile(values, 0.5),
			p95: percentile(values, 0.95),
			p99: percentile(values, 0.99),
			max: canonicalNumber(Math.max(...values)),
			mean: canonicalNumber(sum / values.length),
		};
	});
}

function assertIdentity(identity: RuntimePerformanceIdentity): RuntimePerformanceIdentity {
	if (!/^[a-f0-9]{40}$/u.test(identity.head) || !/^[a-f0-9]{40}$/u.test(identity.tree)) {
		throw new Error('runtime performance evidence requires exact Git head/tree');
	}
	return identity;
}

function gitIdentity(): RuntimePerformanceIdentity {
	const run = (args: string[]) => {
		const result = spawnSync('git', args, {
			cwd: repositoryRoot,
			encoding: 'utf8',
			shell: false,
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '')}`);
		return String(result.stdout ?? '').trim();
	};
	return assertIdentity({
		head: run(['rev-parse', 'HEAD']),
		tree: run(['rev-parse', 'HEAD^{tree}']),
	});
}

// Dependency-update comparisons execute one fixed candidate workload against
// two separately built extension directories. Explicit identity keeps the
// measurement bound to the artifact under test rather than to the test-code checkout.
export function runtimePerformanceIdentityFromEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): RuntimePerformanceIdentity | undefined {
	const head = environment.NEXUS_PERFORMANCE_TARGET_HEAD?.trim();
	const tree = environment.NEXUS_PERFORMANCE_TARGET_TREE?.trim();
	if (!head && !tree) return undefined;
	if (!head || !tree) {
		throw new Error('NEXUS_PERFORMANCE_TARGET_HEAD and NEXUS_PERFORMANCE_TARGET_TREE must be supplied together');
	}
	return assertIdentity({ head, tree });
}

export function runtimePerformanceOutputPath(
	filename: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
		throw new Error('runtime performance output filename must be one local file name');
	}
	const override = environment.NEXUS_PERFORMANCE_OUTPUT_DIR?.trim();
	const directory = override ? resolve(override) : resolve(repositoryRoot, 'artifacts', 'performance');
	return resolve(directory, filename);
}

export function buildRuntimePerformanceEvidence({
	product,
	browser,
	samples,
	recordedAt = new Date().toISOString(),
	identity = gitIdentity(),
}: {
	product: 'halo' | 'spectra';
	browser: { name: string; version: string };
	samples: readonly RuntimePerformanceSample[];
	recordedAt?: string;
	identity?: RuntimePerformanceIdentity;
}) {
	const exactIdentity = assertIdentity(identity);
	return {
		schemaVersion: 1,
		recordedAt,
		product,
		head: exactIdentity.head,
		tree: exactIdentity.tree,
		host: {
			platform: platform(),
			arch: arch(),
			osRelease: osRelease(),
			bun: Bun.version,
			browser,
		},
		metrics: summarizeRuntimePerformance(samples),
	};
}

export function writeRuntimePerformanceEvidence({
	product,
	browser,
	samples,
	outputPath,
	identity,
	recordedAt,
}: {
	product: 'halo' | 'spectra';
	browser: { name: string; version: string };
	samples: readonly RuntimePerformanceSample[];
	outputPath?: string;
	identity?: RuntimePerformanceIdentity;
	recordedAt?: string;
}): string {
	const evidence = buildRuntimePerformanceEvidence({
		product,
		browser,
		samples,
		...(identity ? { identity } : {}),
		...(recordedAt ? { recordedAt } : {}),
	});
	const path = outputPath ?? runtimePerformanceOutputPath(`${product}.${evidence.head}.json`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(`✓ Runtime performance evidence: ${relative(repositoryRoot, path).replaceAll('\\', '/')}`);
	return path;
}
