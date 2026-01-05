// goal: Animation presets for page transitions
// eff: GPU-accelerated transforms, consistent easing curves

import type { AnimationPreset, TransitionType } from './types';

/** Standard easing curve (Material Design inspired) */
const STANDARD_EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
/** Decelerate easing for enter animations */
const DECELERATE_EASING = 'cubic-bezier(0.0, 0.0, 0.2, 1)';
/** Accelerate easing for exit animations */
const ACCELERATE_EASING = 'cubic-bezier(0.4, 0.0, 1, 1)';

/**
 * Animation presets for all transition types.
 * All use transform/opacity for GPU acceleration.
 */
export const ANIMATION_PRESETS: Record<TransitionType, AnimationPreset> = {
	slide: {
		enter: { transform: 'translateX(100%)', opacity: 1 },
		active: { transform: 'translateX(0)', opacity: 1 },
		exit: { transform: 'translateX(-30%)', opacity: 0.5 },
		duration: 280,
		easing: STANDARD_EASING,
	},

	slideUp: {
		enter: { transform: 'translateY(100%)', opacity: 1 },
		active: { transform: 'translateY(0)', opacity: 1 },
		exit: { transform: 'translateY(100%)', opacity: 1 },
		duration: 300,
		easing: DECELERATE_EASING,
	},

	slideDown: {
		enter: { transform: 'translateY(-100%)', opacity: 1 },
		active: { transform: 'translateY(0)', opacity: 1 },
		exit: { transform: 'translateY(-100%)', opacity: 1 },
		duration: 300,
		easing: DECELERATE_EASING,
	},

	fade: {
		enter: { transform: 'translateX(0)', opacity: 0 },
		active: { transform: 'translateX(0)', opacity: 1 },
		exit: { transform: 'translateX(0)', opacity: 0 },
		duration: 200,
		easing: STANDARD_EASING,
	},

	scale: {
		enter: { transform: 'scale(0.92)', opacity: 0 },
		active: { transform: 'scale(1)', opacity: 1 },
		exit: { transform: 'scale(0.92)', opacity: 0 },
		duration: 220,
		easing: STANDARD_EASING,
	},

	none: {
		enter: { transform: 'translateX(0)', opacity: 1 },
		active: { transform: 'translateX(0)', opacity: 1 },
		exit: { transform: 'translateX(0)', opacity: 1 },
		duration: 0,
		easing: 'linear',
	},
};

/**
 * Get reversed preset for opposite direction slides.
 * Used when direction='left' instead of default 'right'.
 */
export function getReversedSlidePreset(preset: AnimationPreset): AnimationPreset {
	const reverseTransform = (t?: string) => {
		if (!t) return t;
		return t
			.replace('translateX(100%)', 'translateX(-100%)')
			.replace('translateX(-30%)', 'translateX(30%)')
			.replace('translateX(-100%)', 'translateX(100%)');
	};

	return {
		...preset,
		enter: { ...preset.enter, transform: reverseTransform(preset.enter.transform) },
		exit: { ...preset.exit, transform: reverseTransform(preset.exit.transform) },
	};
}
