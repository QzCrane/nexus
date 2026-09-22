import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const manifest = JSON.parse(source('public/manifest.json')) as {
	permissions?: string[];
	optional_permissions?: string[];
};
describe('SPECTRA optional capability admission', () => {
	test('keeps non-core userScripts and downloads out of install-time permissions', () => {
		expect(manifest.permissions).not.toContain('userScripts');
		expect(manifest.permissions).not.toContain('downloads');
		expect([...(manifest.optional_permissions ?? [])].sort()).toEqual(['downloads', 'userScripts']);
	});
});
