import { describe, expect, test } from 'bun:test';
import { isControlSnapshot, isControlSubmitRequest, isSpectraResponse, type ControlSnapshot } from '@nexus/contracts';
import { compareMediaObservations, isMediaObservationStamp } from '../../../packages/contracts/src/media-observation.contracts';
import { isSpectraUiResponse } from '@nexus/contracts/ui-runtime';
import { reconcileControlMedia } from '../src/popup/control-snapshot-order';

const stamp = { owner: 'document:owner', epoch: 1, selection: 3, revision: 7 };
const base: ControlSnapshot = { tabId: 1, documentId: 'document', origin: 'https://media.test', generation: 1, revision: 3, activeMedia: null, activeVideo: null, fields: {}, mediaObservation: stamp };
describe('physical media observation contract', () => {
	test('keeps anonymous first-paint expiry evidence strict in canonical and UI responses', () => {
		for (const [data, valid] of [
			[{ tabs: [1, 2], expiryByTab: { '2': 1_000 } }, true],
			[{ tabs: [1, 2], expiryByTab: { '3': 1_000 } }, false],
			[{ tabs: [1, 2], expiryByTab: { '02': 1_000 } }, false],
			[{ tabs: [1, 2], expiryByTab: { '2': -1 } }, false],
			[{ tabs: [1, 2], expiryByTab: { '2': null } }, false],
		] as const) {
			const response = { ok: true, data };
			expect(isSpectraResponse('spectra.tab.visible.list', response)).toBe(valid);
			expect(isSpectraUiResponse('spectra.tab.visible.list', response)).toBe(valid);
		}
	});
	test('shares strict clocks between canonical and UI snapshot guards', () => {
		for (const value of [base, { ...base, mediaObservation: { ...stamp, epoch: -1 } }, { ...base, mediaObservation: { ...stamp, unexpected: 1 } }]) {
			expect(isControlSnapshot(value)).toBe(isSpectraUiResponse('spectra.control.snapshot.get', { ok: true, data: value }));
		}
		expect(isControlSnapshot(base)).toBe(true);
		expect(isMediaObservationStamp({ ...stamp, revision: 1.5 })).toBe(false);
	});
	test('orders owner epochs and refuses conflicting owners or regressing selections', () => {
		expect(compareMediaObservations({ ...stamp, epoch: 2, owner: 'new', selection: 0, revision: 0 }, stamp)).toBe(1);
		expect(compareMediaObservations({ ...stamp, selection: 2, revision: 50 }, stamp)).toBe(-1);
		expect(compareMediaObservations({ ...stamp, owner: 'conflict' }, stamp)).toBeNull();
	});
	test('does not allow Popup to forge automatic replay authority', () => {
		const request = { source: 'restore', requestedCoverage: 'active-target', target: null, patch: { speed: 2 }, mediaRestore: { scene: 'scene:1', revision: 1, visit: 2 } };
		expect(isControlSubmitRequest(request)).toBe(true);
		expect(isControlSubmitRequest({ ...request, source: 'popup' })).toBe(false);
	});
	test('keeps newer physical fields when an otherwise newer control revision carries an old sample', () => {
		const playing = { desired: null, actual: true, revision: 3, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: false, lastError: null, mediaObservation: stamp } as const;
		const current = { ...base, fields: { playing } };
		const older = { ...base, revision: 4, mediaObservation: { ...stamp, revision: 6 }, fields: { playing: { ...playing, actual: false, mediaObservation: { ...stamp, revision: 6 } } } };
		expect(reconcileControlMedia(current, older).fields.playing?.actual).toBe(true);
	});
});
