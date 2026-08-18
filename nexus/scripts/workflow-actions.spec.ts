import { describe, expect, test } from 'bun:test';
import { inspectWorkflowActions } from './check-workflow-actions';

describe('GitHub workflow action supply-chain pins', () => {
	test('accepts a full immutable commit plus version annotation', () => {
		expect(inspectWorkflowActions('fixture.yml', `steps:\n  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n`))
			.toEqual([]);
	});

	test('rejects tags, branches and short SHAs', () => {
		for (const reference of [
			'actions/checkout@v4',
			'actions/checkout@main',
			'actions/checkout@11d5960',
		]) {
			const findings = inspectWorkflowActions('fixture.yml', `- uses: ${reference}\n`);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.message).toContain('not pinned to a full commit SHA');
		}
	});

	test('requires the immutable digest to retain readable release identity', () => {
		const findings = inspectWorkflowActions(
			'fixture.yml',
			'- uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830\n',
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.message).toContain('version comment');
	});

	test('permits repository-local actions without a Git ref', () => {
		expect(inspectWorkflowActions('fixture.yml', '- uses: ./.github/actions/local\n')).toEqual([]);
	});
});
