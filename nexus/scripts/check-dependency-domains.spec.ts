import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkDependencyDomains } from './check-dependency-domains';

describe('dual Bun dependency domains', () => {
	test('runs the actual advisory audit after both frozen installs in canonical quality CI', () => {
		const workflow = readFileSync(new URL('../../.github/workflows/cross-platform.yml', import.meta.url), 'utf8');
		const audit = workflow.indexOf('run: bun --cwd nexus audit:dependencies');
		for (const command of ['run: bun install --frozen-lockfile --ignore-scripts', 'run: bun install --cwd nexus --frozen-lockfile']) {
			const install = workflow.indexOf(command);
			expect(install).toBeGreaterThan(0);
			expect(audit).toBeGreaterThan(install);
		}
		const step = workflow.slice(workflow.lastIndexOf('      - name:', audit), workflow.indexOf('      - name:', audit));
		expect(step).not.toContain('continue-on-error');
		expect(step).not.toContain('if:');
	});

	test('accepts the repository domain policy and closeout evidence', () => {
		expect(() => checkDependencyDomains()).not.toThrow();
	});

	test('rejects a domain that is not frozen in closeout evidence', () => {
		expect(() => checkDependencyDomains({
			policy: {
				schemaVersion: 1,
				domains: [
					{
						id: 'repository-governance', root: '..', packageJson: '../package.json', lockfile: '../bun.lock',
						purpose: 'Repository-local governance dependencies remain intentionally isolated from all product runtime packages.',
						frozenInstall: ['install', '--cwd', '..', '--frozen-lockfile', '--ignore-scripts'],
					},
					{
						id: 'product-workspace', root: '.', packageJson: 'package.json', lockfile: 'bun.lock',
						purpose: 'Product applications and shared packages use an independently frozen workspace dependency resolution universe.',
						frozenInstall: ['install', '--frozen-lockfile'],
					},
				],
			},
			closeout: { platform: { lanes: [['install', '--frozen-lockfile']] } },
		})).toThrow('repository-governance: closeout evidence does not execute');
	});
});
