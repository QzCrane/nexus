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
