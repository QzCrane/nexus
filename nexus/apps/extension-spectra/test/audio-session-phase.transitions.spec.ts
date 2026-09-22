import { describe, expect, test } from 'bun:test';
import { shouldAcceptAudioSessionPhase } from '../src/shared/audio-session-phase';

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
