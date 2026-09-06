import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildDependencyUpdateEvidence } from './dependency-update-evidence';

function writeJson(path: string, value: unknown): void {
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artifact(product: 'halo' | 'spectra', head: string, tree: string, bytes: number) {
	return {
		schemaVersion: 1,
		product,
		head,
		tree,
		totalBytes: bytes,
		files: [{ path: 'manifest.json', bytes, sha256: (product === 'halo' ? 'a' : 'b').repeat(64) }],
	};
}

function performance(product: 'halo' | 'spectra', metric: string, head: string, tree: string, value: number) {
	return {
		schemaVersion: 1,
		product,
		head,
		tree,
		host: { bun: '1.4.0' as string | null, node: process.versions.node, browser: { name: 'Chrome', version: '135.0.7049.114' } },
		metrics: [{
			metric,
			unit: 'ms',
			count: 1,
			min: value,
			p50: value,
			p95: value,
			p99: value,
			max: value,
			mean: value,
		}],
	};
}

const policy = {
	schemaVersion: 1,
	phase: 'baseline',
	minimumSamplesPerMetric: 1,
	products: {
		halo: { workloads: [{ metrics: ['halo.metric'] }] },
		spectra: { workloads: [{ metrics: ['spectra.metric'] }] },
	},
};

function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'nexus-dependency-delta-'));
	const base = resolve(root, 'base');
	const candidate = resolve(root, 'candidate');
	const baseHead = '1'.repeat(40);
	const candidateHead = '2'.repeat(40);
	const baseTree = '3'.repeat(40);
	const candidateTree = '4'.repeat(40);
	for (const [side, head, tree, delta] of [
		[base, baseHead, baseTree, 0],
		[candidate, candidateHead, candidateTree, 10],
	] as const) {
		writeJson(resolve(side, 'artifact-halo.json'), artifact('halo', head, tree, 100 + delta));
		writeJson(resolve(side, 'artifact-spectra.json'), artifact('spectra', head, tree, 200 + delta));
		writeJson(resolve(side, 'performance/halo.json'), performance('halo', 'halo.metric', head, tree, 10 + delta / 10));
		writeJson(resolve(side, 'performance/spectra.json'), performance('spectra', 'spectra.metric', head, tree, 20 + delta / 10));
	}
	return { root, base, candidate };
}

describe('dependency update artifact/performance delta evidence', () => {
	test('reports deterministic artifact and percentile deltas without inventing a baseline verdict', () => {
		const { root, base, candidate } = fixture();
		try {
			const evidence = buildDependencyUpdateEvidence({ baseRoot: base, candidateRoot: candidate, policy: policy as never });
			expect(evidence).toMatchObject({
				schemaVersion: 1,
				phase: 'baseline',
				decision: 'evidence-only-no-budget',
				artifacts: {
					halo: { baseBytes: 100, candidateBytes: 110, deltaBytes: 10 },
					spectra: { baseBytes: 200, candidateBytes: 210, deltaBytes: 10 },
				},
			});
			const halo = evidence.performance.find(({ metric }) => metric === 'halo.metric');
			expect(halo?.p95).toEqual({ base: 10, candidate: 11, absolute: 1, percent: 10 });
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('rejects missing policy metrics rather than comparing incomplete workloads', () => {
		const { root, base, candidate } = fixture();
		try {
			rmSync(resolve(candidate, 'performance/spectra.json'));
			expect(() => buildDependencyUpdateEvidence({
				baseRoot: base, candidateRoot: candidate, policy: policy as never,
			})).toThrow('omitted policy metrics');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('rejects browser drift inside one comparison', () => {
		const { root, base, candidate } = fixture();
		try {
			const changed = performance('halo', 'halo.metric', '2'.repeat(40), '4'.repeat(40), 11);
			changed.host.browser.version = '136.0.0.0';
			writeJson(resolve(candidate, 'performance/halo.json'), changed);
			expect(() => buildDependencyUpdateEvidence({
				baseRoot: base, candidateRoot: candidate, policy: policy as never,
			})).toThrow('browser version changed');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});
	test('accepts Node-hosted Playwright evidence without inventing a Bun version', () => {
		const { root, base, candidate } = fixture();
		try {
			for (const side of [base, candidate]) {
				const path = resolve(side, 'performance/halo.json');
				const value = JSON.parse(readFileSync(path, 'utf8'));
				value.host.bun = null;
				writeJson(path, value);
			}
			expect(buildDependencyUpdateEvidence({ baseRoot: base, candidateRoot: candidate, policy: policy as never }).performance).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('rejects missing runtime identity and host changes instead of comparing unlike drivers', () => {
		const { root, base, candidate } = fixture();
		try {
			const path = resolve(candidate, 'performance/halo.json');
			const value = performance('halo', 'halo.metric', '2'.repeat(40), '4'.repeat(40), 11);
			for (const [field, replacement, error] of [
				['node', null, 'malformed'],
				['node', '99.0.0', 'Node version changed'],
				['bun', null, 'Bun version changed'],
			] as const) {
				writeJson(path, { ...value, host: { ...value.host, [field]: replacement } });
				expect(() => buildDependencyUpdateEvidence({ baseRoot: base, candidateRoot: candidate, policy: policy as never })).toThrow(error);
			}
			writeJson(path, { ...value, host: { ...value.host, browser: { ...value.host.browser, name: 'Firefox' } } });
			expect(() => buildDependencyUpdateEvidence({ baseRoot: base, candidateRoot: candidate, policy: policy as never })).toThrow('browser kind changed');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

});
