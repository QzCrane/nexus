import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	checkFeaturePromotion,
	FROZEN_LEGACY_PROMOTION_BASELINE,
	recordReleaseTestResult,
	REQUIRED_PROMOTION_EVIDENCE,
	verifyFeaturePromotionResults,
	type PromotionEvidenceReference,
	type PromotionPolicy,
} from './check-feature-promotion';
import type { ReleaseTestOwnership } from './check-release-test-owners';

function policy(): PromotionPolicy {
	return {
		schemaVersion: 2,
		legacyBaseline: [...FROZEN_LEGACY_PROMOTION_BASELINE],
		requirements: [...REQUIRED_PROMOTION_EVIDENCE],
		evidence: {},
	};
}

function ownership(): ReleaseTestOwnership {
	return {
		entries: {
			unit: {
				releasePackagePath: 'package.json',
				releaseScript: 'test:halo',
				coveragePackagePath: 'apps/extension-halo/package.json',
				coverageScript: 'test:unit',
			},
		},
		owners: {
			'future-tool': [{ path: 'test/context-menu-activation.spec.ts', entry: 'unit' }],
		},
	};
}

function fullEvidence(reference: PromotionEvidenceReference) {
	return Object.fromEntries(REQUIRED_PROMOTION_EVIDENCE.map((dimension) => [dimension, [{ ...reference }]]));
}

function fakeGit(args: string[]): string {
	if (args[0] === 'status') return '';
	if (args[0] === 'show') return '2026-09-11T00:00:00+00:00';
	return args[1] === 'HEAD' ? 'a'.repeat(40) : 'b'.repeat(40);
}

describe('feature promotion gate', () => {
	test('accepts the repository baseline without pretending historical modules have new evidence', () => {
		expect(() => checkFeaturePromotion()).not.toThrow();
	});

	test('rejects silently expanding the historical promotion baseline', () => {
		const candidate = policy();
		candidate.legacyBaseline.push('future-tool');
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [] },
			ownership: ownership(),
		})).toThrow('legacy promotion baseline is immutable');
	});

	test('rejects a new ready module without all result dimensions', () => {
		const candidate = policy();
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'ready' }] },
			ownership: ownership(),
		})).toThrow('new ready/beta promotion has no evidence record');

		candidate.evidence['future-tool'] = {
			correctness: [{ owner: 'future-tool', testPath: 'test/context-menu-activation.spec.ts', entry: 'unit' }],
		};
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'beta' }] },
			ownership: ownership(),
		})).toThrow('promotion evidence dimensions are incomplete or unknown');
	});

	test('rejects unregistered paths and borrowed test owners', () => {
		const candidate = policy();
		candidate.evidence['future-tool'] = fullEvidence({
			owner: 'future-tool', testPath: 'test/unregistered.spec.ts', entry: 'unit',
		});
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'ready' }] },
			ownership: ownership(),
		})).toThrow('is not registered to a default test entry');

		candidate.evidence['future-tool'] = fullEvidence({
			owner: 'other-tool', testPath: 'test/context-menu-activation.spec.ts', entry: 'unit',
		});
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'ready' }] },
			ownership: ownership(),
		})).toThrow("must use the promoted module's test owner");
	});

	test('records and verifies a real-entry PASS self-report bound to exact materials', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-feature-promotion-'));
		const candidate = policy();
		candidate.evidence['future-tool'] = fullEvidence({
			owner: 'future-tool', testPath: 'test/context-menu-activation.spec.ts', entry: 'unit',
		});
		const admission = { modules: [{ id: 'future-tool', stage: 'ready', surfaces: [] }] };
		try {
			const output = recordReleaseTestResult('unit', {
				policy: candidate, admission, ownership: ownership(), runGit: fakeGit, directory,
			});
			const result = JSON.parse(readFileSync(output, 'utf8'));
			expect(result.body).toMatchObject({
				authority: 'local-execution-self-report',
				authentication: 'none',
				head: 'a'.repeat(40),
				tree: 'b'.repeat(40),
				status: 'PASS',
				entry: { id: 'unit', releaseScript: 'test:halo', args: ['run', 'test:halo'] },
			});
			expect(result.body.claims).toHaveLength(REQUIRED_PROMOTION_EVIDENCE.length);
			expect(result.body.materials.some(({ path }: { path: string }) => (
				path === 'apps/extension-halo/test/context-menu-activation.spec.ts'
			))).toBe(true);
			expect(() => verifyFeaturePromotionResults({
				policy: candidate, admission, ownership: ownership(), runGit: fakeGit, directory,
			})).not.toThrow();

			result.body.status = 'FAIL';
			writeFileSync(output, JSON.stringify(result));
			expect(() => verifyFeaturePromotionResults({
				policy: candidate, admission, ownership: ownership(), runGit: fakeGit, directory,
			})).toThrow('stale or bound to different materials');
		} finally {
			rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('refuses to record PASS while the material or test closure is dirty', () => {
		expect(() => recordReleaseTestResult('unit', {
			runGit(args) {
				if (args[0] === 'status') return ' M nexus/scripts/check-feature-promotion.ts';
				return fakeGit(args);
			},
		})).toThrow('refuses dirty material/test closure');
	});
});
