// goal: Simple CSS-based animated transition wrapper
// eff: Uses CSS transitions instead of React state to avoid infinite loops

import React, { useRef, useEffect, useState } from 'react';

interface SimpleTransitionProps {
	/** Whether content is visible */
	show: boolean;
	/** Animation type */
	type?: 'fade' | 'slideLeft' | 'slideRight';
	/** Duration in ms (default: 280) */
	duration?: number;
	/** Keep content mounted when hidden */
	keepMounted?: boolean;
	/** Additional styles */
	style?: React.CSSProperties;
	/** Children to render */
	children: React.ReactNode;
}

/**
 * SimpleTransition - CSS-based transition component.
 * Uses horizontal slide animations by default.
 */
export const SimpleTransition: React.FC<SimpleTransitionProps> = ({
	show,
	type = 'slideRight',
	duration = 280,
	keepMounted = false,
	style,
	children,
}) => {
	const [mounted, setMounted] = useState(show || keepMounted);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		if (show) {
			setMounted(true);
		} else if (!keepMounted) {
			// Delay unmount until transition completes
			timeoutRef.current = setTimeout(() => {
				setMounted(false);
			}, duration);
		}

		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, [show, keepMounted, duration]);

	if (!mounted) return null;

	// Build transform based on type and show state
	const getTransform = (): string => {
		if (type === 'slideRight') {
			// Enter from right, exit to right
			return show ? 'translateX(0)' : 'translateX(100%)';
		}
		if (type === 'slideLeft') {
			// Enter from left, exit to left  
			return show ? 'translateX(0)' : 'translateX(-100%)';
		}
		return 'translateX(0)';
	};

	// CSS transition styles
	const transitionStyles: React.CSSProperties = {
		transition: `opacity ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`,
		opacity: show ? 1 : 0,
		transform: getTransform(),
		// Hidden elements should not block interaction
		pointerEvents: show ? 'auto' : 'none',
	};

	return (
		<div style={{ ...transitionStyles, ...style }}>
			{children}
		</div>
	);
};

export default SimpleTransition;
