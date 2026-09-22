import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const manifest = JSON.parse(source('public/manifest.json')) as {
	permissions?: string[];
	optional_permissions?: string[];
};
const policy = JSON.parse(source('permission-policy.json')) as {
	permissions: Record<string, { decision: string; narrowing: string }>;
};
describe('SPECTRA tabCapture least-privilege boundary', () => {
	test('keeps tabCapture required only because it is a core full-output strategy', () => {
		expect(manifest.permissions).toContain('tabCapture');
		expect(manifest.optional_permissions).not.toContain('tabCapture');
		expect(policy.permissions.tabCapture?.decision).toBe('required');
		expect(policy.permissions.tabCapture?.narrowing).toContain('one-shot');
	});

});
