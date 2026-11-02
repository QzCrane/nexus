// goal: size the Action Popup from its already-committed intrinsic structure
// inv: one live geometry owner, one document scroll surface, no historical height

import { FRAME_MAX_HEIGHT_PX } from '../shared/popup-bootstrap';
import { createFrameObserverHolder } from './frame-observers';

const frameObservers = createFrameObserverHolder();
let measuredHeight: number | null = null;
let measuredOverflowY: string | null = null;
let applyHandle = 0;
let trackingRevision = 0;

function stopFrameTracking(): void {
	trackingRevision += 1;
	frameObservers.release();
	if (applyHandle !== 0) cancelAnimationFrame(applyHandle);
	applyHandle = 0;
}

/** Actual content owns the size even while control observations are pending. */
export function resolveFrameTarget(content: number): number {
	return Math.max(0, Math.min(Math.round(content), FRAME_MAX_HEIGHT_PX));
}

export function releasePopupFrame(): void {
	stopFrameTracking();
	measuredHeight = null;
	measuredOverflowY = null;
	const html = document.documentElement;
	html.style.height = '';
	html.style.overflowY = '';
}

// All announced slots are committed before paint. Equal card counts may have
// different sizes after visualizer or locale changes; no height is predicted.
// Settings and side-panel changes use this same live geometry owner.
export function trackPopupFrame(): void {
	const container = document.querySelector<HTMLElement>('.view-container');
	stopFrameTracking();
	measuredHeight = null;
	measuredOverflowY = null;
	if (!container) return;
	const revision = trackingRevision;
	const html = document.documentElement;
	const apply = (): void => {
		const content = container.getBoundingClientRect().height;
		if (!Number.isFinite(content) || content <= 0) return;
		const target = resolveFrameTarget(content);
		const overflowY = content > FRAME_MAX_HEIGHT_PX ? 'auto' : 'hidden';
		if (target === measuredHeight && overflowY === measuredOverflowY) return;
		measuredHeight = target;
		measuredOverflowY = overflowY;
		html.style.height = `${target}px`;
		html.style.overflowY = overflowY;
	};
	// Observer delivery only queues work. Root writes during ResizeObserver
// delivery can create an undelivered-notifications loop. Retirement fences
// callbacks already delivered before disconnect or a bootstrap retry.
	const scheduleApply = (): void => {
		if (revision !== trackingRevision || applyHandle !== 0) return;
		applyHandle = requestAnimationFrame(() => {
			if (revision !== trackingRevision) return;
			applyHandle = 0;
			apply();
		});
	};
	const resizeObserver = new ResizeObserver(scheduleApply);
	resizeObserver.observe(container);
	const mutationObserver = new MutationObserver(scheduleApply);
	mutationObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-spectra-structure-ready'],
	});
	frameObservers.replace({ resize: resizeObserver, mutation: mutationObserver });
	apply();
}
