import { describe, expect, test } from 'bun:test';
import { checkReleaseTestOwners } from './check-release-test-owners';

describe('HALO risk-weighted release test ownership', () => {
	test('accepts the repository runtime-owner projection', () => {
		expect(() => checkReleaseTestOwners()).not.toThrow();
	});

	test('rejects a new runtime surface without a focused owner', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'future-runtime', surfaces: ['content-runtime'] }] },
			ownersDocument: { schemaVersion: 1, owners: {} },
			packageDocument: { scripts: { 'test:unit': '' } },
		})).toThrow('risk-test ownership drift');
	});

	test('rejects a registered test that is not executed by the default gates', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'future-runtime', surfaces: ['background-runtime'] }] },
			ownersDocument: {
				schemaVersion: 1,
				owners: { 'future-runtime': ['test/context-menu-activation.spec.ts'] },
			},
			packageDocument: { scripts: { 'test:unit': 'bun test test/other.spec.ts' } },
		})).toThrow('focused test is not executed by a default release gate');
	});
});
