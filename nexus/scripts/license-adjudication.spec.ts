import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseLicenseAdjudicationPolicy } from './release-supply-chain';

const current = JSON.parse(
	readFileSync(new URL('../license-adjudication.json', import.meta.url), 'utf8'),
);

describe('license adjudication policy', () => {
	test('keeps the checked-in policy exact and machine-parseable', () => {
		expect(() => parseLicenseAdjudicationPolicy(current)).not.toThrow();
	});

	test('rejects duplicate exact package/version exceptions', () => {
		const policy = structuredClone(current);
		const entry = {
			name: 'fixture-package',
			version: '1.2.3',
			licenseExpression: 'MIT',
			source: 'https://example.com/fixture/LICENSE',
			reason: 'Reviewed the exact fixture-package 1.2.3 source archive and its bundled license text for this test.',
		};
		policy.unknownLicenses = [entry, structuredClone(entry)];
		expect(() => parseLicenseAdjudicationPolicy(policy)).toThrow('duplicate license adjudication');
	});

	test('rejects package wildcards, non-HTTPS sources, and weak rationale', () => {
		for (const mutation of [
			{ name: 'fixture-*' },
			{ source: 'http://example.com/LICENSE' },
			{ reason: 'because' },
		]) {
			const policy = structuredClone(current);
			policy.unknownLicenses = [{
				name: 'fixture-package',
				version: '1.2.3',
				licenseExpression: 'MIT',
				source: 'https://example.com/fixture/LICENSE',
				reason: 'Reviewed the exact fixture-package 1.2.3 source archive and its bundled license text for this test.',
				...mutation,
			}];
			expect(() => parseLicenseAdjudicationPolicy(policy)).toThrow();
		}
	});
});
