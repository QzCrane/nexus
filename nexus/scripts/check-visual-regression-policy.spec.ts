import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkVisualRegressionPolicy } from './check-visual-regression-policy';

const current = JSON.parse(
	readFileSync(new URL('../visual-regression-policy.json', import.meta.url), 'utf8'),
);

describe('visual regression baseline lifecycle', () => {
	test('accepts the checked-in baseline-required capture policy', () => {
		expect(() => checkVisualRegressionPolicy(structuredClone(current))).not.toThrow();
	});

	test('forbids publishing a certified digest before pinned baselines are re-recorded', () => {
		const policy = structuredClone(current);
		policy.states[0].baselineSha256 = 'a'.repeat(64);
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('cannot publish a certified baseline digest');
	});

	test('requires explicit motion reduction for deterministic capture', () => {
		const policy = structuredClone(current);
		policy.states[0].reducedMotion = false;
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('must disable motion');
	});

	test('rejects fuzzy comparison as an unproven visual threshold', () => {
		const policy = structuredClone(current);
		policy.comparison = 'pixel-threshold';
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('exact-png-sha256');
	});

	test('requires every visual state to have an explicit package update owner', () => {
		const policy = structuredClone(current);
		policy.states[1].updateScript = 'missing:visual-update-owner';
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('package script missing:visual-update-owner is missing');
	});
});
