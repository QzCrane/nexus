import { describe, expect, test } from 'bun:test';
import type { ControlSnapshot } from '@nexus/contracts';
import { classifyControlSnapshot } from '../src/popup/control-snapshot-order';

function snapshot(
	generation: number,
	revision: number,
	documentId = 'document:new',
	origin = 'https://media.example',
): ControlSnapshot {
	return {
		tabId: 7,
		documentId,
		origin,
		generation,
		revision,
		activeMedia: null,
		activeVideo: null,
		fields: {},
	};
}

describe('Popup ControlSnapshot admission', () => {
	test('accepts identity replacement only on a newer tab generation', () => {
		const current = snapshot(5, 9);
		expect(classifyControlSnapshot(current, snapshot(6, 0, 'document:next'))).toBe('accepted');
		expect(classifyControlSnapshot(current, snapshot(5, 10, 'document:other'))).toBe('identity-conflict');
		expect(classifyControlSnapshot(current, snapshot(4, 99, 'document:old'))).toBe('stale');
	});

	test('orders revision only inside one generation and rejects another tab', () => {
		const current = snapshot(5, 9);
		expect(classifyControlSnapshot(current, snapshot(5, 8))).toBe('stale');
		expect(classifyControlSnapshot(current, snapshot(5, 9))).toBe('accepted');
		expect(classifyControlSnapshot(current, { ...snapshot(6, 0), tabId: 8 })).toBe('tab-conflict');
	});
});
