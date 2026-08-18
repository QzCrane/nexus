import { describe, expect, test } from 'bun:test';
import {
	checkFeaturePromotion,
	FROZEN_LEGACY_PROMOTION_BASELINE,
	REQUIRED_PROMOTION_EVIDENCE,
} from './check-feature-promotion';

function policy() {
	return {
		schemaVersion: 1 as const,
		legacyBaseline: [...FROZEN_LEGACY_PROMOTION_BASELINE],
		requirements: [...REQUIRED_PROMOTION_EVIDENCE],
		evidence: {},
	};
}

describe('feature promotion gate', () => {
	test('accepts the repository baseline without pretending historical modules have new evidence', () => {
		expect(() => checkFeaturePromotion()).not.toThrow();
	});

	test('rejects silently expanding the legacy baseline', () => {
		const candidate = policy();
		candidate.legacyBaseline.push('future-tool');
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [] },
		})).toThrow('legacy promotion baseline is immutable');
	});

	test('rejects a new ready module without all evidence dimensions', () => {
		const candidate = policy();
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'ready' }] },
		})).toThrow('new ready/beta promotion has no evidence record');
	});

	test('rejects partial evidence instead of accepting a checkbox', () => {
		const candidate = policy();
		(candidate.evidence as Record<string, Record<string, string[]>>)['future-tool'] = {
			correctness: ['apps/extension-halo/package.json'],
		};
		expect(() => checkFeaturePromotion({
			policy: candidate,
			admission: { modules: [{ id: 'future-tool', stage: 'beta' }] },
		})).toThrow('promotion is missing failureBoundary evidence');
	});
});
