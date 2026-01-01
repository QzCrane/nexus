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
				const domPos = direction === 'x' ? el.scrollLeft : el.scrollTop;
				current = domPos;
				target = domPos;
			}
		};

		const step = () => {
			const diff = target - current;
			if (Math.abs(diff) < 0.1) {
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
			const maxScroll = direction === 'x'
				? el.scrollWidth - el.clientWidth
				: el.scrollHeight - el.clientHeight;

			// IF cannot scroll at all, let browser handle it naturally
			if (maxScroll <= 0) return;

			let delta = 0;
			if (direction === 'x') {
				delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			} else {
				delta = e.deltaY;
			}

			if (e.deltaMode === 1) delta *= 33;
			else if (e.deltaMode === 2) delta *= el.clientHeight;

			// Check if we are at boundary AND moving further out
			const currentPos = direction === 'x' ? el.scrollLeft : el.scrollTop;
			const isAtStart = currentPos <= 1 && delta < 0;
			const isAtEnd = currentPos >= maxScroll - 1 && delta > 0;

			// Only intercept if we have room to move in that direction
			if (!isAtStart && !isAtEnd) {
				e.preventDefault();
				e.stopPropagation();

				if (rafId === null) {
					current = currentPos;
					target = current;
				}

				target = Math.max(0, Math.min(maxScroll, target + delta));

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
