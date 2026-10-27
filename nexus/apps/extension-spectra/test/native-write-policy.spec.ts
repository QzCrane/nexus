import { afterEach, describe, expect, test } from 'bun:test';
import {
	DEFAULT_NATIVE_WRITE_THRESHOLDS,
	configureNativeWritePolicy,
	recordNativeWriteOutcome,
	resetNativeWritePolicy,
	resolveNativeWriteMode,
	snapshotNativeWritePolicy,
} from '../src/content/logic/native-write-policy';

afterEach(() => {
	resetNativeWritePolicy();
});

describe('native write split-ack policy', () => {
	test('starts every site optimistic and demotes it only after the drift limit', () => {
		expect(resolveNativeWriteMode('site-a')).toBe('optimistic');
		recordNativeWriteOutcome('site-a', 'confirmed');
		recordNativeWriteOutcome('site-a', 'drifted');
		// One rollback is not yet proof of a hostile page: the production limit is
		// two inside the window.
		expect(resolveNativeWriteMode('site-a')).toBe('optimistic');
		recordNativeWriteOutcome('site-a', 'drifted');
		expect(resolveNativeWriteMode('site-a')).toBe('verified');
	});

	test('demotes only the offending site', () => {
		recordNativeWriteOutcome('bad', 'drifted');
		recordNativeWriteOutcome('bad', 'drifted');
		recordNativeWriteOutcome('good', 'confirmed');
		recordNativeWriteOutcome('good', 'confirmed');
		expect(resolveNativeWriteMode('bad')).toBe('verified');
		expect(resolveNativeWriteMode('good')).toBe('optimistic');
	});

	test('counts a missing native event as inconclusive rather than as drift', () => {
		// A DRM stream that never fires the event says nothing about whether the
		// page fights us; demoting it would spend a real latency win on a signal
		// with no information.
		for (let index = 0; index < 8; index += 1) {
			recordNativeWriteOutcome('drm-site', 'unconfirmed');
		}
		expect(resolveNativeWriteMode('drm-site')).toBe('optimistic');
	});

	test('recovers a demoted site once a full window comes back clean', () => {
		recordNativeWriteOutcome('site-b', 'drifted');
		recordNativeWriteOutcome('site-b', 'drifted');
		expect(resolveNativeWriteMode('site-b')).toBe('verified');
		for (let index = 0; index < DEFAULT_NATIVE_WRITE_THRESHOLDS.window; index += 1) {
			recordNativeWriteOutcome('site-b', 'confirmed');
		}
		// Self-healing rather than sticky: a one-off page glitch cannot pin an
		// otherwise well-behaved origin forever.
		expect(resolveNativeWriteMode('site-b')).toBe('optimistic');
	});

	test('keeps the window bounded so a long session cannot grow the ledger', () => {
		for (let index = 0; index < 500; index += 1) {
			recordNativeWriteOutcome('site-c', 'confirmed');
		}
		const [site] = snapshotNativeWritePolicy().sites;
		expect(site?.drifts).toBe(0);
	});

	test('verified default mode acts as a global kill switch', () => {
		configureNativeWritePolicy({ defaultMode: 'verified' });
		expect(resolveNativeWriteMode('never-seen')).toBe('verified');
		configureNativeWritePolicy({ defaultMode: 'optimistic' });
		expect(resolveNativeWriteMode('never-seen')).toBe('optimistic');
	});
});
