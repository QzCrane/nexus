// goal: Turn repeated browser-runtime measurements into exact-head p50/p95/p99 evidence.
// inv: finite non-negative samples, one unit per metric, >=20 samples for percentile evidence.

import { randomUUID } from 'node:crypto';
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

export interface RuntimePerformanceProfile {
	id: string;
	scenario: string;
	isolation: 'fresh-profile-per-sample' | 'single-profile-repeated-operation' | 'single-profile-long-session';
	businessAssertions: string[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const MIN_PERCENTILE_SAMPLES = 20;
const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/u;
const processRunId = `${Date.now()}-${process.pid}-${randomUUID()}`;

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

export function assertCleanPerformanceSource(status: string): void {
	if (status.trim()) throw new Error('Runtime evidence requires committed source; dirty files cannot be attributed to HEAD');
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
	assertCleanPerformanceSource(run(['status', '--porcelain', '--untracked-files=normal']));
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
	runId = runtimePerformanceRunId(environment),
): string {
	if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
		throw new Error('runtime performance output filename must be one local file name');
	}
	const override = environment.NEXUS_PERFORMANCE_OUTPUT_DIR?.trim();
	const directory = override ? resolve(override) : resolve(repositoryRoot, 'artifacts', 'performance');
	return resolve(directory, runId, filename);
}

export function runtimePerformanceRunId(environment: NodeJS.ProcessEnv = process.env): string {
	const value = environment.NEXUS_PERFORMANCE_RUN_ID?.trim() || processRunId;
	if (!RUN_ID_PATTERN.test(value)) {
		throw new Error('NEXUS_PERFORMANCE_RUN_ID must be a portable 1..64 character run identity');
	}
	return value;
}

function validateProfile(profile: RuntimePerformanceProfile): RuntimePerformanceProfile {
	if (!RUN_ID_PATTERN.test(profile.id) || !profile.scenario.trim()
		|| !['fresh-profile-per-sample', 'single-profile-repeated-operation', 'single-profile-long-session'].includes(profile.isolation)
		|| !Array.isArray(profile.businessAssertions) || profile.businessAssertions.length === 0
		|| profile.businessAssertions.some((assertion) => !RUN_ID_PATTERN.test(assertion))
		|| new Set(profile.businessAssertions).size !== profile.businessAssertions.length) {
		throw new Error('runtime performance profile is malformed');
	}
	return profile;
}

export function buildRuntimePerformanceEvidence({
	product,
	browser,
	samples,
	profile,
	runId = runtimePerformanceRunId(),
	recordedAt = new Date().toISOString(),
	identity = gitIdentity(),
}: {
	product: 'halo' | 'spectra';
	browser: { name: string; version: string };
	samples: readonly RuntimePerformanceSample[];
	profile: RuntimePerformanceProfile;
	runId?: string;
	recordedAt?: string;
	identity?: RuntimePerformanceIdentity;
}) {
	const exactIdentity = assertIdentity(identity);
	const exactProfile = validateProfile(profile);
	if (!RUN_ID_PATTERN.test(runId)) throw new Error('runtime performance run identity is invalid');
	const rawSamples = samples.map((sample, sequence) => ({ ...sample, sequence }));
	return {
		schemaVersion: 1,
		recordedAt,
		runId,
		product,
		head: exactIdentity.head,
		tree: exactIdentity.tree,
		host: {
			platform: platform(),
			arch: arch(),
			osRelease: osRelease(),
			bun: process.versions.bun ?? null,
			node: process.versions.node,
			browser,
		},
		profile: exactProfile,
		rawSamples,
		metrics: summarizeRuntimePerformance(samples),
	};
}

export function writeRuntimePerformanceEvidence({
	product,
	browser,
	samples,
	profile,
	runId = runtimePerformanceRunId(),
	outputPath,
	identity,
	recordedAt,
}: {
	product: 'halo' | 'spectra';
	browser: { name: string; version: string };
	samples: readonly RuntimePerformanceSample[];
	profile: RuntimePerformanceProfile;
	runId?: string;
	outputPath?: string;
	identity?: RuntimePerformanceIdentity;
	recordedAt?: string;
}): string {
	const evidence = buildRuntimePerformanceEvidence({
		product,
		browser,
		samples,
		profile,
		runId,
		...(identity ? { identity } : {}),
		...(recordedAt ? { recordedAt } : {}),
	});
	const path = outputPath ?? runtimePerformanceOutputPath(`${product}.${evidence.head}.json`, process.env, runId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
	console.log(`✓ Runtime performance evidence: ${relative(repositoryRoot, path).replaceAll('\\', '/')}`);
	return path;
}
