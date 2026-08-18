import { describe, expect, test } from 'bun:test';
import { checkSpectraLeastPrivilege } from './check-spectra-least-privilege';

function decision(overrides: Record<string, unknown> = {}) {
	return {
		decision: 'required' as const,
		capability: 'A concrete capability that requires this install-time permission.',
		evidence: [{ path: 'apps/extension-spectra/public/manifest.json', marker: 'manifest_version' }],
		narrowing: 'A concrete explanation of why a narrower current grant would change the product contract.',
		...overrides,
	};
}

describe('SPECTRA least-privilege policy', () => {
	test('accepts the repository policy as an exact manifest projection', () => {
		expect(() => checkSpectraLeastPrivilege()).not.toThrow();
	});

	test('rejects required permissions that appear without a policy decision', () => {
		expect(() => checkSpectraLeastPrivilege({
		manifest: { permissions: ['tabs', 'storage'], host_permissions: [] },
		policy: {
			schemaVersion: 1,
			app: 'spectra',
			permissions: { tabs: decision() },
			hostPermissions: {},
		},
	})).toThrow('required permission policy drift');
	});

	test('rejects stale policy permissions no longer required by the manifest', () => {
		expect(() => checkSpectraLeastPrivilege({
		manifest: { permissions: ['tabs'], host_permissions: [] },
		policy: {
			schemaVersion: 1,
			app: 'spectra',
			permissions: { tabs: decision(), downloads: decision() },
			hostPermissions: {},
		},
	})).toThrow('required permission policy drift');
	});

	test('forces optionalization candidates to retain a migration owner', () => {
		expect(() => checkSpectraLeastPrivilege({
		manifest: { permissions: ['downloads'], host_permissions: [] },
		policy: {
			schemaVersion: 1,
			app: 'spectra',
			permissions: {
				downloads: decision({ decision: 'optionalization-candidate' }),
			},
			hostPermissions: {},
		},
	})).toThrow('optionalization candidate must remain owned');
	});
});
