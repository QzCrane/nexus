import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

interface UpdateDomain {
	'package-ecosystem': string;
	directory: string;
	'open-pull-requests-limit': number;
	schedule: { interval: string };
	groups?: Record<string, unknown>;
	ignore?: unknown;
	cooldown?: { 'default-days': number };
	'target-branch'?: string;
}

const config = Bun.YAML.parse(readFileSync(
	new URL('../../.github/dependabot.yml', import.meta.url), 'utf8',
)) as { version: number; updates: UpdateDomain[] };

describe('dependency update automation policy', () => {
	test('owns both Bun lock domains and immutable GitHub Actions updates', () => {
		expect(config.version).toBe(2);
		expect(config.updates.map((domain) => [domain['package-ecosystem'], domain.directory])).toEqual([
			['bun', '/'], ['bun', '/nexus'], ['github-actions', '/'],
		]);
	});

	test('keeps routine Bun proposals outside admission without suppressing security fixes', () => {
		for (const domain of config.updates.filter((entry) => entry['package-ecosystem'] === 'bun')) {
			expect(domain['open-pull-requests-limit']).toBe(0);
			expect(domain.schedule.interval).toBe('weekly');
			expect(domain.groups).toBeUndefined();
			expect(domain.ignore).toBeUndefined();
			expect(domain.cooldown).toBeUndefined();
			expect(domain['target-branch']).toBeUndefined();
		}
	});

	test('bounds immutable Actions updates to one reviewed proposal group', () => {
		const actions = config.updates.find((domain) => domain['package-ecosystem'] === 'github-actions');
		expect(actions?.['open-pull-requests-limit']).toBe(1);
		expect(actions?.cooldown).toEqual({ 'default-days': 7 });
		expect(actions?.groups).toEqual({ 'workflow-actions': { patterns: ['*'] } });
	});
});
