import { describe, expect, test } from 'bun:test';
import { checkReleaseTestOwners } from './check-release-test-owners';

function entries(script = 'test:unit') {
	return {
		unit: {
			releasePackagePath: 'apps/extension-halo/package.json',
			releaseScript: script,
			coveragePackagePath: 'apps/extension-halo/package.json',
			coverageScript: script,
		},
	};
}

describe('HALO risk-weighted release test ownership', () => {
	test('accepts the repository owner/default-execution projection', () => {
		expect(() => checkReleaseTestOwners()).not.toThrow();
	});

	test('rejects a new runtime surface without a registered owner', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'future-runtime', surfaces: ['content-runtime'] }] },
			ownersDocument: { schemaVersion: 3, entries: entries(), owners: {} },
		})).toThrow('risk-test ownership drift');
	});

	test('rejects a registered test that is not executed by its declared default entry', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'future-runtime', surfaces: ['background-runtime'] }] },
			ownersDocument: {
				schemaVersion: 3,
				entries: entries('test:smooth-scroll'),
				owners: { 'future-runtime': [{ path: 'test/context-menu-activation.spec.ts', entry: 'unit' }] },
			},
		})).toThrow('is not executed by declared default entry');
	});

	test('rejects source markers because registration only owns execution coverage', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'future-runtime', surfaces: ['background-runtime'] }] },
			ownersDocument: {
				schemaVersion: 3,
				entries: entries(),
				owners: {
					'future-runtime': [{
						path: 'test/context-menu-activation.spec.ts',
						entry: 'unit',
						focusMarkers: ['persistQrcodeActivation'],
					}],
				},
			},
		})).toThrow('must contain only path and entry');
	});

	test('rejects ownership borrowed from a module outside release admission', () => {
		expect(() => checkReleaseTestOwners({
			admission: { modules: [{ id: 'admitted', surfaces: [] }] },
			ownersDocument: {
				schemaVersion: 3,
				entries: entries(),
				owners: { other: [{ path: 'test/context-menu-activation.spec.ts', entry: 'unit' }] },
			},
		})).toThrow('is not an admitted HALO module');
	});
});
