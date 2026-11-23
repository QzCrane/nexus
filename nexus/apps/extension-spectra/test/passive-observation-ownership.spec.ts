import { describe, expect, test } from 'bun:test';
import type { ControlFieldStates } from '@nexus/contracts';
import { mergeMediaObservedFields } from '../src/background/control-coordinator-values';

const runtime = { owner: 'doc:3', epoch: 3, selection: 5, revision: 34 };
const current: ControlFieldStates = { volumeBase: {
	desired: 70, actual: 50, phase: 'error', controlled: true, revision: 3,
	strategy: 'dom-native', coverage: 'active-target', mediaObservation: runtime,
	lastError: { code: 'readback-mismatch', message: 'The page retained 50', retryable: true },
} };
const incoming: ControlFieldStates = { volumeBase: {
	desired: 70, actual: 70, phase: 'applied', controlled: false, revision: 4,
	strategy: 'dom-native', coverage: 'active-target', lastError: null,
} };

describe('passive observation provenance', () => {
	test.each([
		{ owner: 'bootstrap-old', epoch: 2, selection: 99, revision: 999 },
		{ owner: 'bootstrap-foreign', epoch: 3, selection: 99, revision: 999 },
		{ ...runtime, revision: 33 },
	])('never clears a failed physical write using an older or foreign stamp: %j', stamp => {
		expect(mergeMediaObservedFields(current, incoming, stamp, true)).toEqual(current);
	});

	test('accepts a genuinely newer physical sample without replacing its provenance', () => {
		const stamp = { ...runtime, revision: 35 };
		expect(mergeMediaObservedFields(current, incoming, stamp, true).volumeBase).toEqual({
			...incoming.volumeBase, mediaObservation: stamp,
		});
	});
});
