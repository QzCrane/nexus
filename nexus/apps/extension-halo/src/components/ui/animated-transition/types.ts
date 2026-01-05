// goal: Type definitions for AnimatedTransition system
// eff: Centralized animation types for consistent page transitions

import type { CSSProperties, ReactNode } from 'react';

/** Supported animation types */
export type TransitionType =
	| 'slide'      // Horizontal slide (left/right)
	| 'slideUp'    // Vertical slide from bottom
	| 'slideDown'  // Vertical slide from top
	| 'fade'       // Opacity fade
	| 'scale'      // Scale + fade
	| 'none';      // No animation (for reduced-motion)

/** Slide direction for horizontal transitions */
export type SlideDirection = 'left' | 'right';

/** Animation speed presets */
export type AnimationSpeed = 'fast' | 'normal' | 'slow';

/** Animation state during transition */
export type TransitionPhase = 'enter' | 'active' | 'exit' | 'hidden';

/** Single animation keyframe definition */
export interface AnimationKeyframe {
	transform?: string;
	opacity?: number;
}

/** Complete animation preset with enter/active/exit states */
export interface AnimationPreset {
	enter: AnimationKeyframe;
	active: AnimationKeyframe;
	exit: AnimationKeyframe;
	duration: number; // ms
	easing: string;
}

/** Props for AnimatedTransition component */
export interface AnimatedTransitionProps {
	/** Whether to show the content */
	show: boolean;
	/** Animation type (default: 'fade') */
	type?: TransitionType;
	/** Direction for slide animations */
	direction?: SlideDirection;
	/** Override default duration (ms) */
	duration?: number;
	/** Keep DOM mounted when hidden (for keep-alive) */
	keepMounted?: boolean;
	/** Additional CSS class */
	className?: string;
	/** Inline styles to merge */
	style?: CSSProperties;
	/** Callback when enter transition completes */
	onEntered?: () => void;
	/** Callback when exit transition completes */
	onExited?: () => void;
	/** Children to render */
	children: ReactNode;
}

/** Animation configuration in HaloSettings */
export interface AnimationSettings {
	/** Master toggle for animations */
	enabled: boolean;
	/** Animation speed preset */
	speed: AnimationSpeed;
}

/** Default animation settings */
export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
	enabled: true,
	speed: 'normal',
};

/** Duration multipliers for speed presets */
export const SPEED_MULTIPLIERS: Record<AnimationSpeed, number> = {
	fast: 0.6,
	normal: 1.0,
	slow: 1.5,
};
