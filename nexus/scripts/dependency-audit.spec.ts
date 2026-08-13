import { describe, expect, test } from 'bun:test';
import {
	classifyAuditResult,
	runDependencyAudit,
} from './dependency-audit';

describe('dependency audit authority', () => {
	test('accepts only a successful empty Bun advisory report', () => {
		expect(classifyAuditResult({ status: 0, stdout: '{}', stderr: '' })).toEqual({ kind: 'PASS' });
		expect(classifyAuditResult({ status: 1, stdout: '{}', stderr: 'connection closed' })).toEqual({
			kind: 'TRANSIENT_FAILURE',
			detail: 'connection closed',
		});
		expect(classifyAuditResult({ status: 0, stdout: '[]', stderr: '' }).kind).toBe(
			'TRANSIENT_FAILURE',
		);
	});

	test('never retries or downgrades a structured vulnerability report', async () => {
		let executions = 0;
		await expect(runDependencyAudit({
			execute: () => {
				executions += 1;
				return {
					status: 1,
					stdout: JSON.stringify({ vulnerable: [{ severity: 'high' }] }),
					stderr: '',
				};
			},
			wait: async () => undefined,
		})).rejects.toThrow('advisories for: vulnerable');
		expect(executions).toBe(1);
	});

	test('retries transport failures finitely and then fails closed', async () => {
		let executions = 0;
		const waits: number[] = [];
		await expect(runDependencyAudit({
			execute: () => {
				executions += 1;
				return { status: 1, stdout: '', stderr: 'TLS unavailable' };
			},
			wait: async (milliseconds) => {
				waits.push(milliseconds);
			},
		})).rejects.toThrow('infrastructure failed after 6 attempts');
		expect(executions).toBe(6);
		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
	});

	test('can recover from a transient failure without changing advisory semantics', async () => {
		const results = [
			{ status: 1, stdout: '', stderr: 'connection closed' },
			{ status: 0, stdout: '{}', stderr: '' },
		];
		await expect(runDependencyAudit({
			execute: () => results.shift() ?? { status: 1, stdout: '', stderr: 'unexpected call' },
			wait: async () => undefined,
		})).resolves.toBeUndefined();
		expect(results).toHaveLength(0);
	});
});
