import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	buildRuntimePerformanceEvidence,
	assertCleanPerformanceSource,
	percentile,
	runtimePerformanceIdentityFromEnvironment,
	runtimePerformanceOutputPath,
	runtimePerformanceRunId,
	summarizeRuntimePerformance,
	writeRuntimePerformanceEvidence,
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
			profile: {
				id: 'spectra-popup-cold',
				scenario: 'cold popup navigation with settings readback',
				isolation: 'fresh-profile-per-sample',
				businessAssertions: ['settings-loaded', 'navigation-roundtrip'],
			},
			runId: 'fixture-run-1',
			recordedAt: '2026-08-18T00:00:00.000Z',
			identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
		});
		expect(evidence).toMatchObject({
			schemaVersion: 1,
			product: 'spectra',
			head: 'a'.repeat(40),
			tree: 'b'.repeat(40),
			host: { browser: { name: 'Chrome', version: 'fixture' } },
			runId: 'fixture-run-1',
			profile: { id: 'spectra-popup-cold' },
		});
		expect(evidence.rawSamples).toHaveLength(20);
		expect(evidence.rawSamples[19]).toMatchObject({ sequence: 19, value: 24 });
	});

	test('accepts an explicit measured-target identity only when head and tree are both exact SHAs', () => {
		expect(runtimePerformanceIdentityFromEnvironment({})).toBeUndefined();
		expect(runtimePerformanceIdentityFromEnvironment({
			NEXUS_PERFORMANCE_TARGET_HEAD: 'a'.repeat(40),
			NEXUS_PERFORMANCE_TARGET_TREE: 'b'.repeat(40),
		})).toEqual({ head: 'a'.repeat(40), tree: 'b'.repeat(40) });
		expect(() => runtimePerformanceIdentityFromEnvironment({
			NEXUS_PERFORMANCE_TARGET_HEAD: 'a'.repeat(40),
		})).toThrow('must be supplied together');
		expect(() => runtimePerformanceIdentityFromEnvironment({
			NEXUS_PERFORMANCE_TARGET_HEAD: 'not-a-sha',
			NEXUS_PERFORMANCE_TARGET_TREE: 'b'.repeat(40),
		})).toThrow('exact Git head/tree');
	});

	test('isolates comparison output without allowing path traversal through a workload filename', () => {
		const root = resolve(tmpdir(), 'nexus-performance-comparison');
		expect(runtimePerformanceOutputPath('spectra-worker-wake.json', {
			NEXUS_PERFORMANCE_OUTPUT_DIR: root,
			NEXUS_PERFORMANCE_RUN_ID: 'run-2',
		})).toBe(resolve(root, 'run-2', 'spectra-worker-wake.json'));
		expect(() => runtimePerformanceOutputPath('../escape.json', {
			NEXUS_PERFORMANCE_OUTPUT_DIR: root,
		})).toThrow('one local file name');
		expect(() => runtimePerformanceOutputPath('nested/escape.json', {
			NEXUS_PERFORMANCE_OUTPUT_DIR: root,
		})).toThrow('one local file name');
	});

	test('requires portable independent run and representative workload identities', () => {
		expect(runtimePerformanceRunId({ NEXUS_PERFORMANCE_RUN_ID: 'fixed-chrome135-run-1' })).toBe('fixed-chrome135-run-1');
		expect(() => runtimePerformanceRunId({ NEXUS_PERFORMANCE_RUN_ID: '../escape' })).toThrow('portable');
		const samples = Array.from({ length: 20 }, () => ({ metric: 'x', value: 1, unit: 'ms' as const }));
		expect(() => buildRuntimePerformanceEvidence({
			product: 'halo',
			browser: { name: 'Chrome', version: '135' },
			samples,
			profile: { id: 'halo-data', scenario: '', isolation: 'fresh-profile-per-sample', businessAssertions: ['data-visible'] },
			runId: 'run-1',
			identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
		})).toThrow('profile');
	});

	test('retains raw samples in one immutable run path', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-runtime-evidence-'));
		try {
			const outputPath = resolve(root, 'run-1', 'halo.json');
			const input = {
				product: 'halo' as const,
				browser: { name: 'Chrome', version: '135' },
				samples: Array.from({ length: 20 }, (_, value) => ({ metric: 'halo.metric', value, unit: 'ms' as const })),
				profile: { id: 'halo-data', scenario: 'representative data', isolation: 'fresh-profile-per-sample' as const, businessAssertions: ['data-visible'] },
				runId: 'run-1', outputPath, recordedAt: '2026-09-12T00:00:00.000Z',
				identity: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
			};
			writeRuntimePerformanceEvidence(input);
			const document = JSON.parse(readFileSync(outputPath, 'utf8'));
			expect(document.rawSamples).toHaveLength(20);
			expect(document.runId).toBe('run-1');
			expect(() => writeRuntimePerformanceEvidence(input)).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		}
	});
});

test('refuses to attribute dirty or untracked source to a clean Git head', () => {
	expect(() => assertCleanPerformanceSource('')).not.toThrow();
	expect(() => assertCleanPerformanceSource(' M nexus/a.ts')).toThrow('committed source');
	expect(() => assertCleanPerformanceSource('?? nexus/new.ts')).toThrow('committed source');
});
