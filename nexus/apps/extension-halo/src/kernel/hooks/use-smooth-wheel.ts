import { useEffect, RefObject } from 'react';

/**
 * Custom smooth scroll hook using requestAnimationFrame interpolation.
 * Bypasses system/plugin scrolling behavior for consistent, premium feel.
 */
export const useSmoothWheel = (ref: RefObject<HTMLElement | null>, direction: 'x' | 'y' = 'y', stiffness = 0.15) => {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		let target = direction === 'x' ? el.scrollLeft : el.scrollTop;
		let current = target;
		let rafId: number | null = null;

		const syncFromDOM = () => {
			if (rafId === null) {
				current = direction === 'x' ? el.scrollLeft : el.scrollTop;
				target = current;
			}
		};

		const step = () => {
			const diff = target - current;
			if (Math.abs(diff) < 0.2) {
				current = target;
				if (direction === 'x') el.scrollLeft = Math.round(current);
				else el.scrollTop = Math.round(current);
				rafId = null;
				return;
			}

			current += diff * stiffness;
			if (direction === 'x') el.scrollLeft = current;
			else el.scrollTop = current;

			rafId = requestAnimationFrame(step);
		};

		const handleWheel = (e: WheelEvent) => {
			const isScrollable = direction === 'x'
				? el.scrollWidth > el.clientWidth
				: el.scrollHeight > el.clientHeight;

			if (!isScrollable) return;

			// Map wheel to scrolling axis
			let delta = 0;
			if (direction === 'x') {
				// For horizontal containers, use horizontal delta if dominant, else use vertical
				delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			} else {
				delta = e.deltaY;
			}

			// Handle different delta modes (lines, pages, pixels)
			if (e.deltaMode === 1) delta *= 30; // Lines
			else if (e.deltaMode === 2) delta *= el.clientHeight; // Pages

			const maxScroll = direction === 'x'
				? el.scrollWidth - el.clientWidth
				: el.scrollHeight - el.clientHeight;

			// Ensure we are in sync before applying delta
			if (rafId === null) {
				target = direction === 'x' ? el.scrollLeft : el.scrollTop;
				current = target;
			}

			const nextTarget = Math.max(0, Math.min(maxScroll, target + delta));

			// Only intercept if we are actually scrolling or moving
			if (nextTarget !== target || rafId !== null) {
				e.preventDefault();
				e.stopPropagation();
				target = nextTarget;
				if (rafId === null) {
					rafId = requestAnimationFrame(step);
				}
			}
		};

		el.addEventListener('wheel', handleWheel, { passive: false });
		el.addEventListener('scroll', syncFromDOM, { passive: true });
		return () => {
			el.removeEventListener('wheel', handleWheel);
			el.removeEventListener('scroll', syncFromDOM);
			if (rafId !== null) cancelAnimationFrame(rafId);
		};
	}, [ref, direction, stiffness]);
};
