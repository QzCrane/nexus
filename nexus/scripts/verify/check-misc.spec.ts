import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { workflowActionPinIssues } from './check-misc';

const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';

describe('workflow action supply-chain pins', () => {
	test('accepts immutable SHAs plus local and docker actions', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-action-pins-'));
		try {
			mkdirSync(root, { recursive: true });
			writeFileSync(resolve(root, 'good.yml'), [
				'jobs:',
				'  build:',
				'    steps:',
				`      - uses: actions/checkout@${CHECKOUT_SHA} # v4`,
				'      - uses: ./.github/actions/local',
				'      - uses: docker://alpine:3.22',
			].join('\n'));
			expect(workflowActionPinIssues(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});

	test('rejects mutable tags, branches, short SHAs, and missing refs', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-action-pins-'));
		try {
			mkdirSync(root, { recursive: true });
			writeFileSync(resolve(root, 'bad.yaml'), [
				'jobs:',
				'  build:',
				'    steps:',
				'      - uses: actions/checkout@v4',
				'      - uses: owner/action@main',
				'      - uses: owner/action@1234567',
				'      - uses: owner/action',
			].join('\n'));
			const issues = workflowActionPinIssues(root);
			expect(issues).toHaveLength(4);
			expect(issues.every((issue) => issue.includes('immutable 40-hex commit SHA'))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});
