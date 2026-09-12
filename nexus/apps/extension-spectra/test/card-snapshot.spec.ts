import { describe, expect, test } from 'bun:test';
import { hasKnownBackgroundRetentionInputs } from '../src/popup/card/snapshot';

describe('field-level card snapshot coverage', () => {
	test('allows inactive-card eviction only when lifecycle and remote state are both known', () => {
		expect(hasKnownBackgroundRetentionInputs({
			status: { state: 'known', value: {} as never },
			isRemoteActive: { state: 'known', value: false },
		})).toBe(true);
		for (const snapshot of [
			{ status: { state: 'unknown', reason: 'timeout' }, isRemoteActive: { state: 'known', value: false } },
			{ status: { state: 'known', value: {} }, isRemoteActive: { state: 'unknown', reason: 'rejected' } },
		] as const) expect(hasKnownBackgroundRetentionInputs(snapshot as never)).toBe(false);
	});
});
