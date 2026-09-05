import { describe, expect, test } from 'bun:test';
import { missingSourceEvidence } from './source-evidence';

describe('architecture source evidence routing', () => {
	test('accepts evidence only from the declared canonical owner', () => {
		const requirements = [
			{ owner: 'values', fragment: 'projectControlTarget(' },
			{ owner: 'coordinator', fragment: 'ackTarget = response.data.target' },
		] as const;
		const sources = {
			values: 'export function projectControlTarget() {}',
			coordinator: 'ackTarget = response.data.target;',
		};

		expect(missingSourceEvidence(sources, requirements)).toEqual([]);
	});

	test('rejects a fragment that exists only in the wrong owner', () => {
		const requirements = [
			{ owner: 'values', fragment: 'projectControlTarget(' },
		] as const;
		const sources = {
			values: 'export function otherValueHelper() {}',
			coordinator: 'function projectControlTarget() {}',
		};

		expect(missingSourceEvidence(sources, requirements)).toEqual(requirements);
	});

	test('fails closed when a declared owner is absent', () => {
		const requirements = [
			{ owner: 'nativeAsync', fragment: 'seekNativeMedia(' },
		] as const;

		expect(missingSourceEvidence({}, requirements)).toEqual(requirements);
	});
});
