// goal: reject same-generation phase regressions at every audio-state boundary

import type { AudioSessionPhase, SpectraAudioMode } from '@nexus/contracts';

const TRANSITIONAL_PHASES = new Set<AudioSessionPhase>(['starting', 'stopping']);

/**
 * A phase is a claim about a processor, and three combinations of the claim and
 * its supporting fields cannot both be true at once:
 *
 * 1. `active` + `bypass` mode. `active` means "a processor of this document is
 *    running". `bypass` means "no processor is attributable to this document".
 *    Neither the mode may be inferred from the phase (that was SP-03) nor the
 *    phase accepted while the mode denies it. This is what let a same-generation
 *    `error -> active` (SP-08) and an evidence-free `starting -> active` (SP-05)
 *    hand out a Capture lifecycle without a processor.
 * 2. `error` with no error text. A failure that cannot name itself is a missing
 *    field, not a failure report. Accepting it is how an overdue `active -> error`
 *    (SP-07) replaced an acknowledged `active` with an empty, unretryable error.
 * 3. `stopping` with no previous phase. A stop needs an origin; a first-ever
 *    write cannot be mid-stop (SP-04).
 *
 * Each contradiction resolves toward the *least* capable state that remains
 * supportable, never toward a more capable one. Reporting `active` while saying
 * `bypass` therefore degrades to `idle`, not to a preserved `active`.
 */
export function reconcileAudioSessionPhase(
	next: AudioSessionPhase,
	actualMode: SpectraAudioMode,
	lastErrorText: string | null,
	basePhase: AudioSessionPhase | null,
): AudioSessionPhase {
	const unsupportedActive = next === 'active' && actualMode === 'bypass';
	const unsupportedStop = next === 'stopping' && basePhase === null;
	if (unsupportedActive || unsupportedStop) return 'idle';
	if (next === 'error' && !lastErrorText) return basePhase ?? 'idle';
	return next;
}

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
		// A processor may stop or fail before reaching 'active'.
		return nextPhase === 'active' || nextPhase === 'idle' || nextPhase === 'error';
	}
	if (currentPhase === 'stopping') {
		// A user may re-enable audio before the processor finishes stopping.
		return nextPhase === 'idle' || nextPhase === 'active' || nextPhase === 'error';
	}

	// Stable phases (idle, active) must not jump directly to another stable
	// phase. They must go through a transitional phase (already gated above)
	// or report an error. Error retains its original same-generation behavior:
	// error→active/idle is allowed, while recovery to 'starting' requires a
	// new generation (accepted by the generation check above).
	if (currentPhase === 'idle' || currentPhase === 'active') {
		return nextPhase === 'error';
	}
	if (currentPhase === 'error') {
		return nextPhase === 'active' || nextPhase === 'idle';
	}
	return false;
}
