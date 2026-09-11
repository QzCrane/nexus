import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8');

function occurrences(value: string): number {
	return config.split(value).length - 1;
}

describe('dependency update automation policy', () => {
	test('owns both Bun lock domains and immutable GitHub Actions updates', () => {
		expect(occurrences('package-ecosystem: bun')).toBe(2);
		expect(config).toContain('directory: /\n');
		expect(config).toContain('directory: /nexus');
		expect(config).toContain('package-ecosystem: github-actions');
	});

	test('makes release-age cooldown explicit instead of inheriting platform defaults', () => {
		expect(occurrences('semver-major-days: 30')).toBe(2);
		expect(occurrences('semver-minor-days: 7')).toBe(2);
		expect(occurrences('semver-patch-days: 3')).toBe(2);
		expect(occurrences('default-days: 7')).toBe(3);
	});

	test('keeps the TypeScript major compiler epoch outside routine dependency bumps', () => {
	const ignore = config.slice(config.indexOf('ignore:'));
		expect(ignore).toContain('dependency-name: typescript');
		expect(ignore).toContain('version-update:semver-major');
	});
});
