import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	isSaatRegistryServiceEnabled,
} from '../src/components/sidepanel/ActiveServicesContext';
import {
	RELEASE_ACTIVE_SERVICE_CONTRACTS,
} from '../src/kernel/registry/_generated-release-admission';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('HALO generated active-service projection', () => {
	test('every projected service carries explicit lifecycle ownership metadata', () => {
		expect(RELEASE_ACTIVE_SERVICE_CONTRACTS.length).toBeGreaterThan(0);
		for (const contract of RELEASE_ACTIVE_SERVICE_CONTRACTS) {
			expect(contract.owner.trim().length, `${contract.id}: owner`).toBeGreaterThan(0);
			expect(contract.readiness.trim().length, `${contract.id}: readiness`).toBeGreaterThan(0);
			expect(contract.disposer.trim().length, `${contract.id}: disposer`).toBeGreaterThan(0);
		}
	});

	test('provider consumes generated contracts without manual plugin ids or storage keys', () => {
		const provider = source('src/components/sidepanel/ActiveServicesContext.tsx');
		expect(provider).toContain('RELEASE_ACTIVE_SERVICE_CONTRACTS');
		expect(provider).toContain('STORAGE_CONTRACTS_BY_EVENT');
		expect(provider).toContain('bucket.push(contract)');
		expect(provider).toContain("'saat-registry'");
		expect(provider).toContain('isSaatRegistryServiceEnabled');

		for (const contract of RELEASE_ACTIVE_SERVICE_CONTRACTS) {
			expect(provider, `${contract.id}: manual service id`).not.toContain(`'${contract.id}'`);
			if ('key' in contract) {
				expect(provider, `${contract.id}: manual storage key`).not.toContain(`'${contract.key}'`);
			}
		}
	});

	test('SaaT registry activity is ownership-closed and fail-closed', () => {
		const valid = {
			globalEnabled: true,
			scripts: [
				{ managedBy: 'saat-tool', saatToolId: 'tool-a', enabled: true },
				{ managedBy: 'saat-tool', saatToolId: 'tool-b', enabled: false },
				{ managedBy: 'packaged-script', saatToolId: 'tool-c', enabled: true },
			],
		};
		expect(isSaatRegistryServiceEnabled(valid, 'tool-a')).toBe(true);
		expect(isSaatRegistryServiceEnabled(valid, 'tool-b')).toBe(false);
		expect(isSaatRegistryServiceEnabled(valid, 'tool-c')).toBe(false);
		expect(isSaatRegistryServiceEnabled(valid, 'missing')).toBe(false);
		expect(isSaatRegistryServiceEnabled({ ...valid, globalEnabled: false }, 'tool-a')).toBe(false);
		expect(isSaatRegistryServiceEnabled({ scripts: valid.scripts }, 'tool-a')).toBe(false);
		expect(isSaatRegistryServiceEnabled(null, 'tool-a')).toBe(false);
	});

	test('generator schema and provider implementation recognize the same active-service kinds', () => {
		const schema = source('../../scripts/registry-gen/release-admission.ts');
		const provider = source('src/components/sidepanel/ActiveServicesContext.tsx');
		for (const kind of ['storage-enabled', 'userscripts-authority', 'saat-registry']) {
			expect(schema, `schema:${kind}`).toContain(`'${kind}'`);
			expect(provider, `provider:${kind}`).toContain(`'${kind}'`);
		}
	});
});
