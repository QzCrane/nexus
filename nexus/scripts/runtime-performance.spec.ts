import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	buildRuntimePerformanceEvidence,
	percentile,
	summarizeRuntimePerformance,
	type RuntimePerformanceSample,
} from './runtime-performance';

describe('runtime performance evidence', () => {
	test('uses nearest-rank p50/p95/p99 over at least twenty samples', () => {
		const values = Array.from({ length: 20 }, (_, index) => index + 1);
		expect(percentile(values, 0.5)).toBe(10);
		expect(percentile(values, 0.95)).toBe(19);
		expect(percentile(values, 0.99)).toBe(20);
		const samples: RuntimePerformanceSample[] = values.map((value) => ({
			metric: 'cold-interactive',
			value,
			unit: 'ms',
		}));
		expect(summarizeRuntimePerformance(samples)).toEqual([{
			metric: 'cold-interactive',
			unit: 'ms',
			count: 20,
			min: 1,
			p50: 10,
			p95: 19,
			p99: 20,
			max: 20,
			mean: 10.5,
		}]);
	});

	test('fails closed on too few samples, invalid values, or mixed units', () => {
		expect(() => summarizeRuntimePerformance([
			{ metric: 'x', value: 1, unit: 'ms' },
		], 20)).toThrow('requires at least 20 samples');
		expect(() => summarizeRuntimePerformance(Array.from({ length: 20 }, () => ({
			metric: 'x', value: Number.NaN, unit: 'ms' as const,
		})))).toThrow('finite and non-negative');
		expect(() => summarizeRuntimePerformance([
			...Array.from({ length: 19 }, () => ({ metric: 'x', value: 1, unit: 'ms' as const })),
			{ metric: 'x', value: 1, unit: 'bytes' },
		])).toThrow('mixes units');
	});

	test('binds evidence to product and exact Git identity supplied by the caller', () => {
		const samples: RuntimePerformanceSample[] = Array.from({ length: 20 }, (_, index) => ({
			metric: 'popup.cold-interactive',
			value: 5 + index,
			unit: 'ms',
		}));
		const evidence = buildRuntimePerformanceEvidence({
			product: 'spectra',
			browser: { name: 'Chrome', version: 'fixture' },
			samples,
			recordedAt: '2026-08-18T00:00:00.000Z',
			identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
		});
		expect(evidence).toMatchObject({
			schemaVersion: 1,
			product: 'spectra',
			head: 'a'.repeat(40),
			tree: 'b'.repeat(40),
			host: { browser: { name: 'Chrome', version: 'fixture' } },
		});
	});

	test('keeps both product browser release lanes physically connected to percentile evidence', () => {
		const haloPackage = JSON.parse(readFileSync(
			new URL('../apps/extension-halo/package.json', import.meta.url),
			'utf8',
		)) as { scripts: Record<string, string> };
		const spectraPackage = JSON.parse(readFileSync(
			new URL('../apps/extension-spectra/package.json', import.meta.url),
			'utf8',
		)) as { scripts: Record<string, string> };
		const haloPerf = readFileSync(
			new URL('../apps/extension-halo/test/sidepanel-performance-playwright.spec.ts', import.meta.url),
			'utf8',
		);
		const spectraPerf = readFileSync(
			new URL('../apps/extension-spectra/test/performance.spec.ts', import.meta.url),
			'utf8',
		);
		const closeoutPolicy = readFileSync(new URL('../closeout-policy.json', import.meta.url), 'utf8');

		expect(haloPackage.scripts['test:browser-chromium']).toContain('sidepanel-performance-playwright.spec.ts');
		expect(spectraPackage.scripts['test:chrome:dist']).toContain('test:performance');
		expect(haloPerf).toContain('SAMPLE_COUNT = 20');
		expect(haloPerf).toContain('writeRuntimePerformanceEvidence');
		expect(spectraPerf).toContain('SAMPLE_COUNT = 20');
		expect(spectraPerf).toContain('data-spectra-ready');
		expect(spectraPerf).toContain('writeRuntimePerformanceEvidence');
		expect(closeoutPolicy).toContain('scripts/runtime-performance.ts');
	});
});
