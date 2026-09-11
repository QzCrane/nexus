// goal: keep runtime performance evidence complete without inventing thresholds before reproducible baselines exist
// inv: every required workload is release-gated, every metric is source-owned, and baseline mode forbids arbitrary budgets

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'runtime-performance-policy.json');
const METRIC_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

interface Workload {
	testPath: string;
	metrics: string[];
}

interface ProductPolicy {
	packagePath: string;
	script: string;
	workloads: Workload[];
}

interface RuntimePerformancePolicy {
	schemaVersion: 1;
	phase: 'baseline' | 'budgeted';
	minimumSamplesPerMetric: number;
	minimumIndependentRunsBeforeBudget: number;
	products: Record<string, ProductPolicy>;
	budgets?: Record<string, { p95Max?: number; p99Max?: number; maxMax?: number }>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function validatePositiveInteger(value: unknown, field: string): number {
	if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`);
	return Number(value);
}

export function checkRuntimePerformancePolicy(
	policy: RuntimePerformancePolicy = readJson<RuntimePerformancePolicy>(policyPath),
): void {
	if (policy.schemaVersion !== 1) throw new Error('runtime performance policy schemaVersion must be 1');
	if (policy.phase !== 'baseline' && policy.phase !== 'budgeted') {
		throw new Error(`runtime performance policy phase is invalid: ${String(policy.phase)}`);
	}
	const minimumSamples = validatePositiveInteger(policy.minimumSamplesPerMetric, 'minimumSamplesPerMetric');
	const minimumRuns = validatePositiveInteger(
		policy.minimumIndependentRunsBeforeBudget,
		'minimumIndependentRunsBeforeBudget',
	);
	if (minimumSamples < 20) throw new Error('runtime percentile evidence requires at least 20 samples per metric');
	if (minimumRuns < 2) throw new Error('runtime budgets require at least two independent baseline runs');
	if (policy.phase === 'baseline' && policy.budgets !== undefined) {
		throw new Error('baseline phase forbids hard runtime budgets before independent evidence exists');
	}

	const productEntries = Object.entries(policy.products ?? {});
	if (productEntries.length === 0) throw new Error('runtime performance policy has no products');
	const allMetrics = new Set<string>();
	for (const [product, config] of productEntries) {
		if (!config || typeof config !== 'object') throw new Error(`${product}: performance policy is malformed`);
		const packagePath = resolve(workspaceDir, config.packagePath);
		if (!existsSync(packagePath)) throw new Error(`${product}: packagePath does not exist: ${config.packagePath}`);
		const pkg = readJson<{ scripts?: Record<string, string> }>(packagePath);
		const command = pkg.scripts?.[config.script];
		if (!command) throw new Error(`${product}: package script ${config.script} is missing`);
		if (!Array.isArray(config.workloads) || config.workloads.length === 0) {
			throw new Error(`${product}: no runtime performance workloads are registered`);
		}
		const seenTests = new Set<string>();
		for (const workload of config.workloads) {
			if (!workload || typeof workload.testPath !== 'string' || workload.testPath.includes('..')) {
				throw new Error(`${product}: malformed performance testPath`);
			}
			if (seenTests.has(workload.testPath)) throw new Error(`${product}: duplicate workload ${workload.testPath}`);
			seenTests.add(workload.testPath);
			const testPath = resolve(workspaceDir, workload.testPath);
			if (!existsSync(testPath)) throw new Error(`${product}: performance test is missing: ${workload.testPath}`);
			const basename = workload.testPath.split('/').at(-1);
			if (!basename || !command.includes(basename)) {
				throw new Error(`${product}: ${workload.testPath} is not owned by package script ${config.script}`);
			}
			if (!Array.isArray(workload.metrics) || workload.metrics.length === 0) {
				throw new Error(`${product}: ${workload.testPath} has no required metrics`);
			}
			const source = readFileSync(testPath, 'utf8');
			for (const metric of workload.metrics) {
				if (typeof metric !== 'string' || !METRIC_ID.test(metric)) {
					throw new Error(`${product}: invalid metric id ${String(metric)}`);
				}
				if (allMetrics.has(metric)) throw new Error(`runtime metric has multiple workload owners: ${metric}`);
				allMetrics.add(metric);
				if (!source.includes(metric)) {
					throw new Error(`${product}: ${workload.testPath} no longer emits required metric ${metric}`);
				}
			}
		}
	}

	if (policy.phase === 'budgeted') {
		const budgets = policy.budgets;
		if (!budgets) throw new Error('budgeted phase requires a budget for every metric');
		const budgetMetrics = Object.keys(budgets).sort();
		const requiredMetrics = [...allMetrics].sort();
		if (budgetMetrics.join('\0') !== requiredMetrics.join('\0')) {
			throw new Error('runtime budgets must be exact-set equal to required metrics');
		}
		for (const [metric, budget] of Object.entries(budgets)) {
			if (!budget || typeof budget !== 'object') throw new Error(`${metric}: runtime budget is malformed`);
			const values = [budget.p95Max, budget.p99Max, budget.maxMax].filter((value) => value !== undefined);
			if (values.length === 0 || values.some((value) => !Number.isFinite(value) || Number(value) < 0)) {
				throw new Error(`${metric}: runtime budget needs finite non-negative percentile/max bounds`);
			}
		}
	}

	console.log(
		`✓ Runtime performance policy: phase=${policy.phase}; products=${productEntries.length}; metrics=${allMetrics.size}; minimumSamples=${minimumSamples}; minimumRunsBeforeBudget=${minimumRuns}`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkRuntimePerformancePolicy();
}
