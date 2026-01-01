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

		const step = () => {
			const diff = target - current;
			// Stop conditions
			if (Math.abs(diff) < 0.2) {
				current = target;
				if (direction === 'x') el.scrollLeft = current;
				else el.scrollTop = current;
				rafId = null;
				return;
			}

			current += diff * stiffness;
			if (direction === 'x') el.scrollLeft = current;
			else el.scrollTop = current;

			rafId = requestAnimationFrame(step);
		};

		const handleWheel = (e: WheelEvent) => {
			// Check if we can scroll
			const isScrollable = direction === 'x'
				? el.scrollWidth > el.clientWidth
				: el.scrollHeight > el.clientHeight;

			if (!isScrollable) return;

			e.preventDefault();
			e.stopPropagation();

			const delta = (direction === 'x' && e.deltaX !== 0) ? e.deltaX : e.deltaY;
			const maxScroll = direction === 'x'
				? el.scrollWidth - el.clientWidth
				: el.scrollHeight - el.clientHeight;

			target = Math.max(0, Math.min(maxScroll, target + delta));

			if (rafId === null) {
				rafId = requestAnimationFrame(step);
			}
		};

		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', handleWheel);
			if (rafId !== null) cancelAnimationFrame(rafId);
		};
	}, [ref, direction, stiffness]);
};
