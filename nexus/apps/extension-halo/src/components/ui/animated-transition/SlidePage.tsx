// goal: Single sliding page wrapper with CSS transition animations
// eff: Standalone component for horizontal slide enter/exit transitions

import type React from 'react';
import { useRef, useEffect, useState } from 'react';
import { ANIMATION_CONSTANTS } from '../../../kernel/core/animations';

interface SlidePageProps {
	/** Whether this page is currently active */
	show: boolean;
	/** Animation direction: 'right' = slides in from right, 'left' = slides in from left */
	direction?: 'left' | 'right';
	/** Duration override (ms) */
	duration?: number;
	/** Keep mounted when hidden */
	keepMounted?: boolean;
	/** Additional styles */
	style?: React.CSSProperties;
	/** Children */
	children: React.ReactNode;
}

/**
 * SlidePage - Wrapper for a single sliding page.
 * Use for sub-page navigation like list → editor.
 *
 * @example
 * <SlidePage show={showEditor} direction="right">
 *   <EditorPage />
 * </SlidePage>
 */
export const SlidePage: React.FC<SlidePageProps> = ({
	show,
	direction = 'right',
	duration = ANIMATION_CONSTANTS.DURATION.DEFAULT,
	keepMounted = false,
	style,
	children,
}) => {
	const [shouldRender, setShouldRender] = useState(show || keepMounted);

	// Always start as 'exited' so we can animate in, even on first mount
	const [animState, setAnimState] = useState<'entering' | 'entered' | 'exiting' | 'exited'>('exited');
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current);

		if (show) {
			// Always trigger enter animation
			setShouldRender(true);

			// Use double RAF to ensure browser registers the starting state before transition
			requestAnimationFrame(() => {
				setAnimState('entering');
				requestAnimationFrame(() => {
					setAnimState('entered');
				});
			});
		} else {
			setAnimState('exiting');
			timeoutRef.current = setTimeout(() => {
				setAnimState('exited');
				if (!keepMounted) setShouldRender(false);
			}, duration);
		}

		return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
	}, [show, keepMounted, duration]);

	if (!shouldRender) return null;

	// Calculate transform: offset is the starting position for enter/exiting states
	const offset = direction === 'right' ? '100%' : '-100%';
	const transform = animState === 'entered' ? 'translateX(0)' : `translateX(${offset})`;
	const isActive = animState === 'entering' || animState === 'entered';

	return (
		<div
			style={{
				position: 'absolute',
				top: 0, left: 0, width: '100%', height: '100%',
				transform,
				opacity: isActive ? 1 : 0,
				transition: `var(--halo-motion-transition, transform ${duration}ms ${ANIMATION_CONSTANTS.EASING.DEFAULT}, opacity ${duration}ms ${ANIMATION_CONSTANTS.EASING.DEFAULT})`,
				pointerEvents: show ? 'auto' : 'none',
				// Fix text blurriness: avoid willChange, use backfaceVisibility
				backfaceVisibility: 'hidden',
				WebkitBackfaceVisibility: 'hidden',
				...style,
			}}
		>
			{children}
		</div>
	);
};

export default SlidePage;
