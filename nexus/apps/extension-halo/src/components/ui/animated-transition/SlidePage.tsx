// goal: Single sliding page wrapper with CSS transition animations
// eff: Standalone component for horizontal slide enter/exit transitions

import React, { useRef, useEffect, useState } from 'react';

// Animation constants
const DEFAULT_DURATION = 280;
const EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

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
	duration = DEFAULT_DURATION,
	keepMounted = false,
	style,
	children,
}) => {
	const [shouldRender, setShouldRender] = useState(show || keepMounted);
	const [animState, setAnimState] = useState<'entering' | 'entered' | 'exiting' | 'exited'>(
		show ? 'entered' : 'exited'
	);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	
	useEffect(() => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		
		if (show) {
			setShouldRender(true);
			setAnimState('entering');
			// Ensure DOM update before transition starts
			requestAnimationFrame(() => {
				requestAnimationFrame(() => setAnimState('entered'));
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
				transition: `transform ${duration}ms ${EASING}, opacity ${duration}ms ${EASING}`,
				pointerEvents: show ? 'auto' : 'none',
				willChange: 'transform, opacity',
				...style,
			}}
		>
			{children}
		</div>
	);
};

export default SlidePage;
