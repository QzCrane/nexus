import { describe, expect, test } from 'bun:test';
import type { ControlApplyAck, ControlIntent, ControlOperationAck, ControlOperationIntent } from '@nexus/contracts';
import { controlApplyAckMatches, controlOperationAckMatches } from '../src/background/control-coordinator-ack';
import { controlCoordinatorTestApi } from '../src/background/control-coordinator';

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

	test('returns before successful-use badge persistence and projection settle', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let releaseWrite!: () => void;
		let signalWriteStarted!: () => void;
		const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
		const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
		const values: Record<string, unknown> = {};
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => {
						signalWriteStarted();
						await writeGate;
						Object.assign(values, items);
					},
					remove: async (key: string) => { delete values[key]; },
				} },
			},
		});

		try {
			let returned = false;
			controlCoordinatorTestApi.scheduleSuccessfulExtensionUse(8_401, 'popup');
			returned = true;
			await writeStarted;
			expect(returned).toBe(true);
			expect(values['spectra.badge.used.8401']).toBeUndefined();

			releaseWrite();
			await controlCoordinatorTestApi.flushSessionProjections();
			expect(values['spectra.badge.used.8401']).toBe(true);
		} finally {
			releaseWrite();
			await controlCoordinatorTestApi.flushSessionProjections();
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
