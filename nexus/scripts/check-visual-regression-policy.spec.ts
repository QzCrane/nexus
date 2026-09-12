import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { checkVisualRegressionPolicy } from './check-visual-regression-policy';
import { verifyVisualRegressionCandidate } from './verify-visual-regression-candidate';

const current = JSON.parse(
	readFileSync(new URL('../visual-regression-policy.json', import.meta.url), 'utf8'),
);

function digest(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

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

	test('requires representative pairwise data, error, dynamic, permission, locale, theme and narrow states', () => {
		for (const mutate of [
			(policy: typeof current) => { policy.states = policy.states.filter((state: { scenario: string }) => state.scenario !== 'dynamic'); },
			(policy: typeof current) => { for (const state of policy.states) state.locale = 'en-US'; },
			(policy: typeof current) => { for (const state of policy.states) state.theme = 'dark'; },
			(policy: typeof current) => { policy.states = policy.states.filter((state: { width: number }) => state.width > 320); },
		]) {
			const policy = structuredClone(current);
			mutate(policy);
			expect(() => checkVisualRegressionPolicy(policy)).toThrow('representative pairwise');
		}
	});

	test('requires each registered state to name browser-derived assertions and focus ownership', () => {
		const policy = structuredClone(current);
		policy.states[0].assertions = [];
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('browser assertions');
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

	test('requires every visual state to have an executable non-update verification owner', () => {
		const policy = structuredClone(current);
		policy.states[1].verifyScript = 'missing:visual-verifier';
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('package verification script missing:visual-verifier is missing');
	});

	test('requires the workspace verification script to be physically executed by the pinned browser workflow', () => {
		const policy = structuredClone(current);
		policy.verification.workflowPath = 'package.json';
		expect(() => checkVisualRegressionPolicy(policy)).toThrow('visual verification workflow does not execute');
	});

	test('enforced exact comparison accepts an identical candidate and rejects one-byte drift', () => {
		const directory = mkdtempSync(join(tmpdir(), 'nexus-visual-regression-'));
		try {
			const baselinePath = join(directory, 'baseline.png');
			const candidatePath = join(directory, 'candidate.png');
			const baselineContent = 'deterministic-png-fixture';
			writeFileSync(baselinePath, baselineContent);
			writeFileSync(candidatePath, baselineContent);
			const policy = {
				phase: 'enforced' as const,
				comparison: 'exact-png-sha256' as const,
				states: [{
					id: 'fixture.visual.state',
					baselinePath: 'baseline.png',
					baselineSha256: digest(baselineContent),
				}],
			};
			const matched = verifyVisualRegressionCandidate({
				stateId: 'fixture.visual.state',
				candidatePath,
				baselinePath,
				updateBaseline: false,
				policy,
				workspaceDir: directory,
			});
			expect(matched.mode).toBe('matched');

			writeFileSync(candidatePath, `${baselineContent}!`);
			expect(() => verifyVisualRegressionCandidate({
				stateId: 'fixture.visual.state',
				candidatePath,
				baselinePath,
				updateBaseline: false,
				policy,
				workspaceDir: directory,
			})).toThrow('visual regression');
		} finally {
			rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('baseline-required captures candidates without claiming certified equality', () => {
		const directory = mkdtempSync(join(tmpdir(), 'nexus-visual-candidate-'));
		try {
			const baselinePath = join(directory, 'baseline.png');
			const candidatePath = join(directory, 'candidate.png');
			writeFileSync(candidatePath, 'candidate-only');
			const result = verifyVisualRegressionCandidate({
				stateId: 'fixture.review.state',
				candidatePath,
				baselinePath,
				updateBaseline: false,
				policy: {
					phase: 'baseline-required',
					comparison: 'exact-png-sha256',
					states: [{
						id: 'fixture.review.state',
						baselinePath: 'baseline.png',
						baselineSha256: null,
					}],
				},
				workspaceDir: directory,
			});
			expect(result.mode).toBe('candidate-only');
		} finally {
			rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});
});
