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

/**
 * The three tones the product palette reserves for volume presentation.
 *
 * This is the *one* vocabulary the volume bar inside the Popup and the toolbar
 * Action badge both speak. They used to decide independently - the bar from the
 * gesture, the badge from a boolean `isCapture` that ignored the volume - which
 * is how the same page could show a violet bar next to a blue badge below 100,
 * and a blue badge next to a violet bar right after a crossing.
 */
export type VolumeTone = 'muted' | 'native' | 'capture';

/**
 * Whether the document's own scale can absorb a value above 100.
 *
 * `page-native` is a page that exposes its own amplifier (a custom player), so
 * Boost never needs the processor. `dom-native` is a plain `<video>`/`<audio>`,
 * whose `volume` is capped at 1.0, so anything above 100 *must* be routed
 * through the processor. Absent means the page has not answered yet, and an
 * unanswered route never predicts a hijack.
 */
export type VolumeNativeRoute = 'page-native' | 'dom-native' | null;

/**
 * The route an already acknowledged Boost was applied through.
 *
 * Once a document has acknowledged a Boost, the card knows which owner holds
 * the amplified part of the scale, and that answer outranks the page-level
 * route guess above: a page whose media runs on the page-lifetime Web Audio
 * graph is amplified without ever hijacking the tab.
 */
export type VolumeBoostRoute = 'capture' | 'media-webaudio' | null;

export interface VolumeToneInput {
	readonly volume: number;
	readonly muted: boolean;
	readonly enabled: boolean;
	/** An acknowledged processor that is currently hijacking this document. */
	readonly captureActive: boolean;
	/**
	 * True only for a live gesture, where the tone may run ahead of the
	 * acknowledgement that settles it. A settled frame never predicts.
	 */
	readonly predict?: boolean;
	readonly nativeRoute?: VolumeNativeRoute;
	readonly boostRoute?: VolumeBoostRoute;
}

/**
 * The single tone decision behind the Popup slider and the Action badge.
 *
 * Rule: violet means "this document is being hijacked by Capture", never
 * "the number passed 100". An acknowledged active Capture owns the tone at every
 * volume - that is what makes a step from 100 to 110 change nothing, instead of
 * repainting on the threshold. Prediction exists for exactly one case: a live
 * gesture crossing above the native ceiling on a document that has no page-level
 * amplifier, because the user must see the route change under their finger
 * rather than one acknowledgement later.
 */
export function resolveVolumeTone(input: VolumeToneInput): VolumeTone {
	if (input.muted || input.volume <= 0) return 'muted';
	if (!input.enabled) return 'native';
	if (input.captureActive) return 'capture';
	if (input.predict !== true || input.volume <= CONTROL_VALUE_LIMITS.volumeBase.max) {
		return 'native';
	}
	if (input.boostRoute === 'capture') return 'capture';
	if (input.boostRoute === 'media-webaudio') return 'native';
	return input.nativeRoute === 'dom-native' ? 'capture' : 'native';
}

/** Reads the Boost route out of an acknowledged control field state. */
export function resolveBoostRoute(strategy: string | null | undefined): VolumeBoostRoute {
	if (strategy === 'capture') return 'capture';
	if (strategy === 'media-webaudio') return 'media-webaudio';
	return null;
}

/** Reads the native-scale route out of an acknowledged control field state. */
export function resolveNativeRoute(strategy: string | null | undefined): VolumeNativeRoute {
	if (strategy === 'page-native') return 'page-native';
	if (strategy === 'dom-native') return 'dom-native';
	return null;
}
