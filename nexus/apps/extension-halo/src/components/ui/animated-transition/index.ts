// goal: Barrel export for animated-transition module
// eff: Clean public API

export { AnimatedTransition } from './AnimatedTransition';
export { PageTransition } from './PageTransition';
export { useAnimationSettings } from './useAnimationSettings';
export { ANIMATION_PRESETS, getReversedSlidePreset } from './presets';
export type {
	TransitionType,
	SlideDirection,
	AnimationSpeed,
	TransitionPhase,
	AnimationPreset,
	AnimatedTransitionProps,
	AnimationSettings,
} from './types';
export { DEFAULT_ANIMATION_SETTINGS, SPEED_MULTIPLIERS } from './types';
