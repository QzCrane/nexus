import { describe, expect, test } from 'bun:test';
import {
	reconcileAudioSessionPhase,
	shouldAcceptAudioSessionPhase,
} from '../src/shared/audio-session-phase';

const phases = ['idle', 'starting', 'active', 'stopping', 'error'] as const;

// Independent lifecycle oracle for one generation. Rows are the acknowledged
// phase and columns are the candidate phase in `phases` order.
const sameGenerationOracle = {
	idle: [true, false, false, false, true],
	starting: [true, true, true, false, true],
	active: [false, false, true, false, true],
	stopping: [true, false, true, true, true],
	error: [true, false, true, false, true],
} as const;

describe('audio session phase transitions', () => {
	test('matches the complete same-generation lifecycle matrix', () => {
		for (const current of phases) {
			for (const [index, next] of phases.entries()) {
				expect(
					shouldAcceptAudioSessionPhase(7, current, 7, next),
					`${current} -> ${next}`,
				).toBe(sameGenerationOracle[current][index]);
			}
		}
	});

	test('orders every phase solely by generation before applying the phase matrix', () => {
		for (const current of phases) {
			for (const next of phases) {
				expect(shouldAcceptAudioSessionPhase(7, current, 8, next), `${current} -> ${next} newer`).toBe(true);
				expect(shouldAcceptAudioSessionPhase(7, current, 6, next), `${current} -> ${next} older`).toBe(false);
			}
		}
	});
});

describe('audio session phase evidence', () => {
	test('never reports active while the same write claims no processor owns the document', () => {
		// SP-05 / SP-08: 'active' + 'bypass' is a lifecycle claim with nothing behind it.
		expect(reconcileAudioSessionPhase('active', 'bypass', null, 'error')).toBe('idle');
		expect(reconcileAudioSessionPhase('active', 'bypass', null, 'starting')).toBe('idle');
		expect(reconcileAudioSessionPhase('active', 'bypass', null, null)).toBe('idle');
		// A processor that does exist keeps its active claim.
		expect(reconcileAudioSessionPhase('active', 'capture', null, 'starting')).toBe('active');
		expect(reconcileAudioSessionPhase('active', 'webaudio', null, null)).toBe('active');
	});

	test('never records a failure that cannot name itself', () => {
		// SP-07: an overdue error must not overwrite an acknowledged active state
		// unless it can report what failed.
		expect(reconcileAudioSessionPhase('error', 'capture', null, 'active')).toBe('active');
		expect(reconcileAudioSessionPhase('error', 'bypass', null, 'idle')).toBe('idle');
		expect(reconcileAudioSessionPhase('error', 'bypass', null, null)).toBe('idle');
		expect(reconcileAudioSessionPhase('error', 'capture', 'device lost', 'active')).toBe('error');
	});

	test('never starts a document in the middle of a stop', () => {
		// SP-04: the first write for a document has no origin to stop from.
		expect(reconcileAudioSessionPhase('stopping', 'capture', null, null)).toBe('idle');
		expect(reconcileAudioSessionPhase('stopping', 'capture', null, 'active')).toBe('stopping');
	});

	test('leaves every supportable phase untouched', () => {
		for (const next of phases) {
			expect(reconcileAudioSessionPhase(next, 'capture', 'failed', 'active'), next).toBe(next);
		}
	});
});
