// goal: one palette for actual audio state and an explicitly staged gesture
// inv: prospective routes affect presentation only; processor ownership requires ACK

import { CONTROL_VALUE_LIMITS } from './control-value-limits.js';

export type VolumeTone = 'muted' | 'native' | 'capture';

export type VolumeNativeRoute = 'page-native' | 'dom-native' | null;

export type VolumeBoostRoute = 'capture' | 'media-webaudio' | null;

/** Actual lifecycle and the source-bound policy candidate have separate duties. */
export interface VolumeToneInput {
	readonly volume: number;
	readonly muted: boolean;
	readonly enabled: boolean;
	readonly captureActive: boolean;
	readonly predict?: boolean;
	readonly prospectiveBoostRoute?: VolumeBoostRoute;
	readonly boostRoute?: VolumeBoostRoute;
}

export function resolveVolumeTone(input: VolumeToneInput): VolumeTone {
	if (input.muted || input.volume <= 0) return 'muted';
	if (!input.enabled) return 'native';
	// Only a value above the native ceiling has a Boost route to hand over. At or
	// below it every split is Boost 1, so a processor that has not torn down yet
	// is passthrough and must read as native. Checking the level first is what
	// makes the colour follow the ceiling in both directions: crossing up to 110
	// turns violet on the gesture frame, and crossing down to 100 turns blue on
	// that same frame instead of waiting for the release acknowledgement.
	if (input.volume <= CONTROL_VALUE_LIMITS.volumeBase.max) return 'native';
	if (input.captureActive) return 'capture';
	if (input.predict !== true) return 'native';
	if (input.prospectiveBoostRoute !== undefined) {
		return input.prospectiveBoostRoute === 'capture' ? 'capture' : 'native';
	}
	if (input.boostRoute === 'capture') return 'capture';
	return 'native';
}

export function resolveBoostRoute(strategy: string | null | undefined): VolumeBoostRoute {
	if (strategy === 'capture') return 'capture';
	if (strategy === 'media-webaudio') return 'media-webaudio';
	return null;
}

export function resolveNativeRoute(strategy: string | null | undefined): VolumeNativeRoute {
	if (strategy === 'page-native') return 'page-native';
	if (strategy === 'dom-native') return 'dom-native';
	return null;
}
