import { describe, expect, test } from 'bun:test';
import {
	createHeader,
	normalizeHeaders,
} from '../src/tools/api-tester/core';
import type { Header } from '../src/tools/api-tester/types';
import {
	createMockField,
	normalizeMockFields,
} from '../src/tools/mock-data/core';
import type { MockField } from '../src/tools/mock-data/types';

describe('persisted editable-row identities', () => {
	test('upgrades legacy and duplicate API headers exactly once', () => {
		const existing = createHeader();
		const legacy = { key: 'Accept', value: 'application/json', enabled: true };
		const duplicate = { ...existing };
		const input = [existing, legacy, duplicate] as Header[];
		const upgraded = normalizeHeaders(input);

		expect(upgraded).not.toBe(input);
		expect(upgraded[0]).toBe(existing);
		expect(new Set(upgraded.map(({ id }) => id)).size).toBe(3);
		expect(upgraded[1]?.key).toBe('Accept');
		expect(normalizeHeaders(upgraded)).toBe(upgraded);
	});

	test('upgrades legacy and duplicate mock fields exactly once', () => {
		const existing = createMockField('id', 'uuid');
		const legacy = { name: 'email', type: 'email' };
		const duplicate = { ...existing };
		const upgraded = normalizeMockFields(
			[existing, legacy, duplicate] as MockField[],
		);

		expect(upgraded[0]).toBe(existing);
		expect(new Set(upgraded.map(({ id }) => id)).size).toBe(3);
		expect(upgraded[1]?.name).toBe('email');
		expect(normalizeMockFields(upgraded)).toBe(upgraded);
	});
});
