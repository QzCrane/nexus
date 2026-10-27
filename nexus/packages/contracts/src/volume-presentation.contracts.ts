// goal: one executable owner for when a volume gesture must hold the displayed tone
// inv: the displayed number never waits; only the tone waits for the route ACK
// inv: the native/boost boundary is CONTROL_VALUE_LIMITS.volumeBase.max, not a literal
// eff: pure predicate; no state, no clock, no transport
// post: false whenever the effective volume did not actually change

import { CONTROL_VALUE_LIMITS } from './control-value-limits.js';

export interface VolumeRouteHoldInput {
	readonly previousEffectiveVolume: number;
	readonly nextEffectiveVolume: number;
	/** True when the same patch also flips mute, so the tone must not repaint early. */
	readonly mutedChanged: boolean;
}

/**
 * A route change is the native (`<= 100`) to boost (`> 100`) boundary in either
 * direction. It is the only volume movement that can hand the document to a
 * different physical owner, which is why it is the only one whose *tone* must
 * wait for the acknowledgement.
 */
export function crossesVolumeRoute(
	previousEffectiveVolume: number,
	nextEffectiveVolume: number,
): boolean {
	const boundary = CONTROL_VALUE_LIMITS.volumeBase.max;
	return (previousEffectiveVolume > boundary) !== (nextEffectiveVolume > boundary);
}

/**
 * Holds the last confirmed tone while a volume transaction is unsettled.
 *
 * This predicate deliberately does not describe the displayed number. Holding
 * the number is what froze the slider at the gesture's start value for the rest
 * of a cross-boundary drag: the slider spans 0..800, so an ordinary drag crosses
 * 100 constantly, and a held number stops tracking the pointer entirely.
 *
 * Non-finite inputs return false: a hold built on unknown values would pin the
 * tone to a route nothing can explain.
 */
export function shouldHoldVolumeTone(input: VolumeRouteHoldInput): boolean {
	const { previousEffectiveVolume, nextEffectiveVolume, mutedChanged } = input;
	if (!Number.isFinite(previousEffectiveVolume) || !Number.isFinite(nextEffectiveVolume)) {
		return false;
	}
	if (nextEffectiveVolume === previousEffectiveVolume) return false;
	return mutedChanged || crossesVolumeRoute(previousEffectiveVolume, nextEffectiveVolume);
}
