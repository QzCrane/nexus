import { describe, expect, test } from 'bun:test';
import { mintStartIntent, verifyProcessorAck } from '@nexus/contracts';

describe('processor ack', () => {
	test('accepts only an ack that echoes the minted intent', () => {
		const intent = mintStartIntent();
		expect(verifyProcessorAck(intent, {
			intentId: intent.intentId,
			nonce: intent.nonce,
			ackSequence: 1,
		})).toBe(true);
	});

	test('fails closed on every way an ack can fail to be tied to a start', () => {
		const intent = mintStartIntent();
		const other = mintStartIntent();
		// No ACK at all, no intent at all, a foreign nonce, and a non-positive
		// sequence all answer the same way: this is not evidence for my start.
		expect(verifyProcessorAck(intent, undefined)).toBe(false);
		expect(verifyProcessorAck(null, { intentId: intent.intentId, nonce: intent.nonce, ackSequence: 1 })).toBe(false);
		expect(verifyProcessorAck(intent, { intentId: intent.intentId, nonce: other.nonce, ackSequence: 1 })).toBe(false);
		expect(verifyProcessorAck(intent, { intentId: intent.intentId, nonce: intent.nonce, ackSequence: 0 })).toBe(false);
	});

	test('rejects a replayed ack whose sequence does not advance', () => {
		const intent = mintStartIntent();
		const first = { intentId: intent.intentId, nonce: intent.nonce, ackSequence: 4 };
		expect(verifyProcessorAck(intent, first, 3)).toBe(true);
		// The same ACK twice: only "positive" was checked, a replay would pass.
		expect(verifyProcessorAck(intent, first, 4)).toBe(false);
		expect(verifyProcessorAck(intent, { ...first, ackSequence: 3 }, 3)).toBe(false);
	});

	test('mints a distinct intent every time', () => {
		const first = mintStartIntent();
		const second = mintStartIntent();
		expect(first.intentId).not.toBe(second.intentId);
		expect(first.nonce).not.toBe(second.nonce);
	});
});
