import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { analyzeThirdPartySourceProvenance } from './check-third-party-source-provenance';

const currentPolicy = JSON.parse(
	readFileSync(new URL('../third-party-source-policy.json', import.meta.url), 'utf8'),
);
const currentAdmission = JSON.parse(
	readFileSync(new URL('../apps/extension-halo/release-admission.json', import.meta.url), 'utf8'),
);

function codes(policy: unknown = currentPolicy, admission: unknown = currentAdmission): string[] {
	return analyzeThirdPartySourceProvenance({ policy: policy as never, admission: admission as never })
		.map(({ code }) => code);
}

describe('non-npm third-party source provenance', () => {
	test('accepts the current exact BiliPlus-derived release owner', () => {
		expect(codes()).toEqual([]);
	});

	test('does not allow a free-form Source marker to stand in for a policy owner', () => {
		const policy = structuredClone(currentPolicy);
		policy.entries = [];
		expect(codes(policy)).toContain('unowned-source-marker');
	});

	test('requires an exact upstream commit, blob identities and SPDX license evidence', () => {
		for (const mutate of [
			(entry: any) => { entry.upstream.commit = 'main'; },
			(entry: any) => { entry.upstream.files[0].blobSha = 'short'; },
			(entry: any) => { entry.upstream.license.blobSha = 'not-a-sha'; },
			(entry: any) => { entry.upstream.license.spdx = ''; },
		]) {
			const policy = structuredClone(currentPolicy);
			mutate(policy.entries[0]);
			expect(codes(policy).length).toBeGreaterThan(0);
		}
	});

	test('requires the derived source to remain release-admitted', () => {
		const admission = structuredClone(currentAdmission);
		admission.modules = admission.modules.map((module: any) => (
			module.id === 'bilibili-enhancer'
				? { ...module, surfaces: module.surfaces.filter((surface: string) => surface !== 'script-runtime') }
				: module
		));
		expect(codes(currentPolicy, admission)).toContain('not-release-admitted');
	});

	test('rejects weak modification history and missing shipped notice ownership', () => {
		const weak = structuredClone(currentPolicy);
		weak.entries[0].modifications = ['changed'];
		expect(codes(weak)).toContain('modifications-weak');

		const missingNotice = structuredClone(currentPolicy);
		missingNotice.entries[0].noticePath = 'apps/extension-halo/public/DOES_NOT_EXIST.txt';
		expect(codes(missingNotice)).toContain('notice-missing');
	});
});
