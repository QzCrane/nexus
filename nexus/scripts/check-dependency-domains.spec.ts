import { describe, expect, test } from 'bun:test';
import { checkDependencyDomains } from './check-dependency-domains';

describe('dual Bun dependency domains', () => {
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
