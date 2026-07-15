// goal: reject same-generation phase regressions at every audio-state boundary

import type { AudioSessionPhase } from '@nexus/contracts';

const TRANSITIONAL_PHASES = new Set<AudioSessionPhase>(['starting', 'stopping']);

export function shouldAcceptAudioSessionPhase(
	currentGeneration: number,
	currentPhase: AudioSessionPhase,
	nextGeneration: number,
	nextPhase: AudioSessionPhase,
): boolean {
	if (nextGeneration !== currentGeneration) return nextGeneration > currentGeneration;
	if (nextPhase === currentPhase) return true;

	// A stable/error ACK is authoritative for its generation. A delayed intent
	// notification must never put the UI or persistence mirror back in flight.
	if (!TRANSITIONAL_PHASES.has(currentPhase) && TRANSITIONAL_PHASES.has(nextPhase)) {
		return false;
	}

	if (currentPhase === 'starting') {
		return nextPhase === 'active' || nextPhase === 'error';
	}
	if (currentPhase === 'stopping') {
		return nextPhase === 'idle' || nextPhase === 'error';
	}

	return true;
}
