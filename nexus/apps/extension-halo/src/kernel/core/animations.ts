// goal: SSOT for animation constants
// eff: Centralizes duration and easing curves for consistent motion design

export const ANIMATION_CONSTANTS = {
	// Standard durations (ms)
	DURATION: {
		FAST: 150,
		DEFAULT: 250, // Standard page transition
		SLOW: 350,
	},

	// Easing curves (Cubic Bezier)
	EASING: {
		// Standard cohesive motion (Material Design 3 emphasis)
		DEFAULT: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
		// Entrance (Decelerate)
		ENTER: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
		// Exit (Accelerate)
		EXIT: 'cubic-bezier(0.4, 0.0, 1, 1)',
		// Bouncy
		BOUNCE: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
	}
} as const;

export type AnimationDuration = keyof typeof ANIMATION_CONSTANTS.DURATION;
export type AnimationEasing = keyof typeof ANIMATION_CONSTANTS.EASING;
