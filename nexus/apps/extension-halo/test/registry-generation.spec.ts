import { describe, expect, test } from 'bun:test';
import { canonicalPluginDirectoryNames } from '../../../scripts/registry-gen/discover.ts';

describe('HALO registry generation', () => {
	test('canonicalizes filesystem discovery order before generating artifacts', () => {
		const discovered = ['zeta', 'api-tester', 'hover-zoom', 'base64', 'bilibili-plus'];
		expect(canonicalPluginDirectoryNames(discovered)).toEqual([
			'api-tester',
			'base64',
			'bilibili-plus',
			'hover-zoom',
			'zeta',
		]);
		expect(discovered).toEqual(['zeta', 'api-tester', 'hover-zoom', 'base64', 'bilibili-plus']);
	});
});
