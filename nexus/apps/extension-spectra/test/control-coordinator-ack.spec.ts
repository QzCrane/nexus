import { describe, expect, test } from 'bun:test';
import type { ControlApplyAck, ControlIntent, ControlOperationAck, ControlOperationIntent } from '@nexus/contracts';
import { controlApplyAckMatches, controlOperationAckMatches } from '../src/background/control-coordinator-ack';

const applyIntent = {
	intentId: 'intent-1', tabId: 7, documentId: 'document-1', generation: 3,
	baseRevision: 5, source: 'popup', requestedCoverage: 'active-target', target: null,
	actualContext: {}, patch: { speed: 1.5 },
} as ControlIntent;
const applyAck = {
	intentId: 'intent-1', tabId: 7, documentId: 'document-1', generation: 3,
	revision: 6, target: null, fields: {},
} as ControlApplyAck;

describe('control coordinator acknowledgement identity', () => {
	test('admits only the complete intent transaction identity', () => {
		expect(controlApplyAckMatches(applyAck, applyIntent)).toBe(true);
		for (const mutation of [
			{ intentId: 'intent-old' }, { tabId: 8 }, { documentId: 'document-old' },
			{ generation: 2 }, { revision: 5 },
			{ target: { documentId: 'document-old', frameId: 0, mediaId: 'm', sourceRevision: 1, kind: 'audio' } },
		]) expect(controlApplyAckMatches({ ...applyAck, ...mutation } as ControlApplyAck, applyIntent)).toBe(false);
	});

	test('admits only the exact operation and transaction identity', () => {
		const intent = { ...applyIntent, operationId: 'operation-1', operation: 'playback-toggle', payload: {} } as ControlOperationIntent;
		const ack = {
			...applyAck, operationId: 'operation-1', operation: 'playback-toggle', strategy: 'dom-native',
			coverage: 'active-target', result: { playing: true },
		} as ControlOperationAck;
		expect(controlOperationAckMatches(ack, intent)).toBe(true);
		expect(controlOperationAckMatches({ ...ack, operation: 'seek-relative' } as ControlOperationAck, intent)).toBe(false);
		expect(controlOperationAckMatches({ ...ack, operationId: 'operation-old' } as ControlOperationAck, intent)).toBe(false);
	});
});
