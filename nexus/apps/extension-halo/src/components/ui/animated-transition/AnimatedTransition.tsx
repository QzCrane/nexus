// goal: Core AnimatedTransition component for unified page transitions
// eff: GPU-accelerated, respects user settings, supports keep-alive

import React, { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react';
import type { AnimatedTransitionProps, TransitionPhase } from './types';
import { ANIMATION_PRESETS, getReversedSlidePreset } from './presets';
import { useAnimationSettings } from './useAnimationSettings';

/**
 * AnimatedTransition - Unified component for page/sub-page transitions.
 * 
 * Features:
 * - GPU-accelerated animations (transform/opacity)
 * - Respects user animation preferences
 * - Supports keep-alive (keepMounted)
 * - Multiple animation types (slide, fade, scale, slideUp)
 * 
 * @example
 * // Basic fade transition
 * <AnimatedTransition show={isVisible}>
 *   <MyContent />
 * </AnimatedTransition>
 * 
 * @example
 * // Slide-up sub-page with keep-alive
 * <AnimatedTransition show={showEditor} type="slideUp" keepMounted>
 *   <EditorPage />
 * </AnimatedTransition>
 */
export const AnimatedTransition: React.FC<AnimatedTransitionProps> = ({
	show,
	type = 'fade',
	direction = 'right',
	duration: customDuration,
	keepMounted = false,
	className,
	style,
	onEntered,
	onExited,
	children,
}) => {
	// Use default animation settings
	const { getDuration, isDisabled } = useAnimationSettings();
	const [phase, setPhase] = useState<TransitionPhase>(show ? 'active' : 'hidden');
	const [shouldRender, setShouldRender] = useState(show || keepMounted);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const nodeRef = useRef<HTMLDivElement>(null);
	
	// Store callbacks in refs to avoid dependency issues
	const onEnteredRef = useRef(onEntered);
	const onExitedRef = useRef(onExited);
	onEnteredRef.current = onEntered;
	onExitedRef.current = onExited;

	// Memoize preset to avoid recalculating on every render
	const preset = useMemo(() => {
		const basePreset = ANIMATION_PRESETS[isDisabled ? 'none' : type];
		return type === 'slide' && direction === 'left' 
			? getReversedSlidePreset(basePreset) 
			: basePreset;
	}, [type, direction, isDisabled]);

	// Calculate actual duration
	const actualDuration = customDuration ?? getDuration(preset.duration);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, []);

	// Handle show/hide transitions
	useEffect(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}

		if (show) {
			// Enter transition
			setShouldRender(true);
			
			if (isDisabled || actualDuration === 0) {
				setPhase('active');
				onEnteredRef.current?.();
			} else {
				// Start from enter state
				setPhase('enter');
				
				// Use requestAnimationFrame to ensure enter styles are applied before transitioning
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						setPhase('active');
						timeoutRef.current = setTimeout(() => {
							onEnteredRef.current?.();
						}, actualDuration);
					});
				});
			}
		} else {
			// Exit transition
			if (isDisabled || actualDuration === 0) {
				setPhase('hidden');
				if (!keepMounted) setShouldRender(false);
				onExitedRef.current?.();
			} else {
				setPhase('exit');
				timeoutRef.current = setTimeout(() => {
					setPhase('hidden');
					if (!keepMounted) setShouldRender(false);
					onExitedRef.current?.();
				}, actualDuration);
			}
		}
	}, [show, isDisabled, actualDuration, keepMounted]);

	// Don't render if not needed
	if (!shouldRender) return null;

	// Build styles based on current phase
	const phaseStyles = useMemo((): CSSProperties => {
		const keyframe = phase === 'enter' ? preset.enter
			: phase === 'exit' ? preset.exit
			: phase === 'active' ? preset.active
			: preset.exit; // hidden uses exit styles

		return {
			transform: keyframe.transform,
			opacity: keyframe.opacity,
			transition: actualDuration > 0 
				? `transform ${actualDuration}ms ${preset.easing}, opacity ${actualDuration}ms ${preset.easing}`
				: 'none',
		};
	}, [phase, preset, actualDuration]);

	const containerStyles: CSSProperties = {
		...phaseStyles,
		willChange: actualDuration > 0 ? 'transform, opacity' : 'auto',
		// Hidden state should not block interactions
		pointerEvents: phase === 'hidden' ? 'none' : 'auto',
		visibility: phase === 'hidden' ? 'hidden' : 'visible',
		// Full size by default
		width: '100%',
		height: '100%',
		...style,
	};

	return (
		<div 
			ref={nodeRef}
			className={className}
			style={containerStyles}
		>
			{children}
		</div>
	);
};

export default AnimatedTransition;
