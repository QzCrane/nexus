import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkRuntimePerformancePolicy } from './check-runtime-performance-policy';

const current = JSON.parse(
	readFileSync(new URL('../runtime-performance-policy.json', import.meta.url), 'utf8'),
);

describe('runtime performance policy', () => {
	test('accepts the checked-in baseline workload owner', () => {
		expect(() => checkRuntimePerformancePolicy(structuredClone(current))).not.toThrow();
	});

	test('forbids arbitrary hard budgets while baseline evidence is still being established', () => {
		const mutated = structuredClone(current);
		mutated.budgets = {
			'spectra.popup.navigation-to-interactive': { p95Max: 100 },
		};
		expect(() => checkRuntimePerformancePolicy(mutated)).toThrow('baseline phase forbids hard runtime budgets');
	});

	test('requires at least two independent runs before a budgeted epoch', () => {
		const mutated = structuredClone(current);
		mutated.minimumIndependentRunsBeforeBudget = 1;
		expect(() => checkRuntimePerformancePolicy(mutated)).toThrow('at least two independent baseline runs');
	});

	test('requires raw immutable evidence and a pinned browser owner', () => {
		const missingRaw = structuredClone(current);
		missingRaw.evidence.samples = 'summary-only';
		expect(() => checkRuntimePerformancePolicy(missingRaw)).toThrow('retain raw samples');
		const missingBrowser = structuredClone(current);
		missingBrowser.browserOwner = 'package.json';
		expect(() => checkRuntimePerformancePolicy(missingBrowser)).toThrow('pinned Chrome');
	});

	test('requires representative workload and business-assertion registration', () => {
		const mutated = structuredClone(current);
		mutated.products.halo.workloads[0].businessAssertions = [];
		expect(() => checkRuntimePerformancePolicy(mutated)).toThrow('representative workload');
	});

	test('keeps diagnostic metrics evidence-only until a reasoned SLO exists', () => {
		const missingReason = structuredClone(current);
		delete missingReason.products.spectra.workloads[3].evidenceOnlyReason;
		expect(() => checkRuntimePerformancePolicy(missingReason)).toThrow('explain evidence-only');
		const invented = structuredClone(current);
		invented.phase = 'budgeted';
		invented.budgets = Object.fromEntries([
			...invented.products.spectra.workloads,
			...invented.products.halo.workloads,
		].flatMap((workload: { metrics: string[] }) => workload.metrics)
			.map((metric: string) => [metric, { p95Max: 100 }]));
		expect(() => checkRuntimePerformancePolicy(invented)).toThrow();
	});

	test('rejects a workload that disappears from the product performance command', () => {
		const mutated = structuredClone(current);
		mutated.products.spectra.script = 'test:smoke';
		expect(() => checkRuntimePerformancePolicy(mutated)).toThrow('is not owned by package script');
	});

	test('rejects duplicate metric ownership across workloads', () => {
		const mutated = structuredClone(current);
		mutated.products.spectra.workloads[1].metrics.push(
			mutated.products.spectra.workloads[0].metrics[0],
		);
		expect(() => checkRuntimePerformancePolicy(mutated)).toThrow('multiple workload owners');
	});
});
