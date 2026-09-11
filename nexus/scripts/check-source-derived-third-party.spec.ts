import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkSourceDerivedThirdParty } from './check-source-derived-third-party';

const current = JSON.parse(
	readFileSync(new URL('../source-derived-third-party.json', import.meta.url), 'utf8'),
);

function clonePolicy(): typeof current {
	return structuredClone(current);
}

describe('source-derived third-party release provenance', () => {
	test('accepts the exact checked-in upstream and shipped notice owner', () => {
		expect(() => checkSourceDerivedThirdParty(clonePolicy())).not.toThrow();
	});

	test('rejects non-exact upstream identity and unsafe local ownership', () => {
		const shortSha = clonePolicy();
		shortSha.entries[0].upstreamCommit = '70b8d7e';
		expect(() => checkSourceDerivedThirdParty(shortSha)).toThrow('exact commit SHA');

		const escaped = clonePolicy();
		escaped.entries[0].localPath = '../borrowed.js';
		expect(() => checkSourceDerivedThirdParty(escaped)).toThrow('must stay inside');
	});

	test('rejects stale local or notice provenance markers', () => {
		const localMarker = clonePolicy();
		localMarker.entries[0].localMarker = 'Source: a-different-upstream';
		expect(() => checkSourceDerivedThirdParty(localMarker)).toThrow('local source provenance marker is stale');

		const notice = clonePolicy();
		notice.entries[0].noticeMarkers = [
			...notice.entries[0].noticeMarkers,
			'NOT_PRESENT_IN_NOTICE',
		];
		expect(() => checkSourceDerivedThirdParty(notice)).toThrow('shipped notice is missing');
	});

	test('does not allow a non-admitted HALO script to masquerade as shipped source-derived code', () => {
		const policy = clonePolicy();
		policy.entries[0].id = 'not-admitted-derived-script';
		expect(() => checkSourceDerivedThirdParty(policy)).toThrow('not in the admitted script runtime projection');
	});
});
