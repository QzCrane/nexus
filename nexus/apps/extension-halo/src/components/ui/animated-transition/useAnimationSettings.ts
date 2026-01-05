// goal: Hook for accessing global animation settings
// eff: Respects user preferences and reduced-motion

import { useMemo } from 'react';
import type { AnimationSettings, AnimationSpeed } from './types';
import { DEFAULT_ANIMATION_SETTINGS, SPEED_MULTIPLIERS } from './types';

/** Check if user prefers reduced motion */
function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Hook to get animation settings from global context.
 * Falls back to defaults and respects reduced-motion preference.
 * 
 * Note: Uses prop-based settings passed via AnimatedTransition.
 * This avoids circular dependency with SidePanelContext.
 */
export function useAnimationSettings(settingsOverride?: {
	enableAnimations?: boolean;
	animationSpeed?: AnimationSpeed;
}): AnimationSettings & {
	getDuration: (baseDuration: number) => number;
	isDisabled: boolean;
} {
	return useMemo(() => {
		// Use override settings or defaults
		const enabled = settingsOverride?.enableAnimations ?? DEFAULT_ANIMATION_SETTINGS.enabled;
		const speed = settingsOverride?.animationSpeed ?? DEFAULT_ANIMATION_SETTINGS.speed;

		// Check system preference for reduced motion
		const reducedMotion = prefersReducedMotion();
		const isDisabled = !enabled || reducedMotion;

		// Duration calculator based on speed setting
		const getDuration = (baseDuration: number): number => {
			if (isDisabled) return 0;
			return Math.round(baseDuration * SPEED_MULTIPLIERS[speed]);
		};

		return {
			enabled,
			speed,
			isDisabled,
			getDuration,
		};
	}, [settingsOverride?.enableAnimations, settingsOverride?.animationSpeed]);
}
