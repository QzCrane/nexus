// goal: hold the Action Popup window at the height its content actually needs,
// predicting the first frame and animating every correction instead of snapping
// inv: the document height must never be the reason a card appears to move

import { logger } from '../shared/logger';
import {
	FRAME_HEIGHT_KEY,
	FRAME_HEIGHT_KEY_LAST,
	FRAME_MAX_HEIGHT_PX,
	FRAME_PLAN_PARAM,
	frameHeightKeyForCards,
} from '../shared/popup-bootstrap';
import { createFrameObserverHolder } from './frame-observers';

// Chrome sizes an Action Popup window from the document, and the document is a
// brand new realm on every open. Nothing that decides the layout - the tab
// inventory, each card's control snapshot - is available synchronously, so a
// content-derived height always settles after the first paint. Left alone that
// surfaces as two window resizes in front of the user: one when the active-tab
// card commits, another when the background list lands.
//
// The decision is therefore made *before* this document exists. The Background
// counts the media tabs it already knows about and states the count in the
// Popup's URL; every open records the height it settled on under that count. The
// head script (`frame-reserve.js`) reads the count from the URL, looks up the
// height that shape settled on, and sizes the document before the first paint -
// so a shape that has been opened once opens at its own height forever after,
// even when the previous open was a different shape.

let measuredHeight: number | null = null;
let measuredOverflowY: string | null = null;
let predictedHeight: number | null = null;
// The observers are the frame's only continuous presence in the document. A
// Popup that retries its bootstrap would stack a second pair on the same
// container, and a released frame would still be re-sized by the pair that was
// never disconnected - which is how a failed bootstrap ended up with the
// reservation painted back over the error surface.
const frameObservers = createFrameObserverHolder();
let applyHandle = 0;
let trackingRevision = 0;

function stopFrameTracking(): void {
	trackingRevision += 1;
	frameObservers.release();
	if (applyHandle !== 0) cancelAnimationFrame(applyHandle);
	applyHandle = 0;
}

function clampFrameHeight(value: number): number {
	return Math.max(0, Math.min(Math.round(value), FRAME_MAX_HEIGHT_PX));
}

/**
 * The card count this open was announced with.
 *
 * It is a projection, never authority: the Popup renders whatever the inventory
 * says. It only selects which recorded height is the right starting point, and a
 * wrong answer costs one correction, exactly as it would without the hint.
 */
export function plannedCardCount(): number | null {
	try {
		const raw = new URLSearchParams(window.location.search).get(FRAME_PLAN_PARAM);
		if (raw === null || !/^\d{1,3}$/u.test(raw)) return null;
		const cards = Number(raw);
		return Number.isSafeInteger(cards) && cards >= 0 ? cards : null;
	} catch (error) {
		logger.popup.debug('[Popup] frame plan parameter unreadable', error);
		return null;
	}
}

function readStoredHeight(key: string): number | null {
	let raw: string | null;
	try {
		raw = window.localStorage.getItem(key);
	} catch (error) {
		logger.popup.debug('[Popup] frame height hint unreadable', error);
		return null;
	}
	if (raw === null) return null;
	const stored = Number(raw);
	return Number.isFinite(stored) && stored > 0 ? clampFrameHeight(stored) : null;
}

/**
 * The height to open at: this shape's own settled height, then the most recent
 * one, then the single hint older versions wrote.
 *
 * The middle fallback is deliberately not the *nearest* count's height. Two
 * cards taller than one is a law; three cards taller than two is not (a paused
 * card keeps its whole card, an empty one does not), so guessing by
 * interpolation would trade one wrong number for another. A first open of a new
 * shape grows once, records its own height, and never grows again.
 */
function readFrameHeight(cards: number | null): number | null {
	if (cards !== null) {
		const exact = readStoredHeight(frameHeightKeyForCards(cards));
		if (exact !== null) return exact;
	}
	return readStoredHeight(FRAME_HEIGHT_KEY_LAST) ?? readStoredHeight(FRAME_HEIGHT_KEY);
}

function writeStoredHeight(key: string, height: number): void {
	try {
		window.localStorage.setItem(key, String(height));
	} catch (error) {
		// note: a denied storage area only costs the next open one re-measure
		logger.popup.debug('[Popup] frame height hint not persisted', error);
	}
}

// eff: records the height this shape settled on, for the next open of this shape
function persistFrameHeight(cards: number, height: number): void {
	const settled = clampFrameHeight(height);
	if (!Number.isFinite(settled) || settled <= 0) return;
	writeStoredHeight(frameHeightKeyForCards(cards), settled);
	writeStoredHeight(FRAME_HEIGHT_KEY_LAST, settled);
	// Kept in step so an older build reading the legacy key (or a downgrade)
	// still opens at a height this content can use.
	writeStoredHeight(FRAME_HEIGHT_KEY, settled);
}

function renderedCardCount(): number {
	return document.querySelectorAll('#main-stage .glass-card, #bg-stack .glass-card').length;
}

/**
 * The key this open's settled height belongs to: the count the Background
 * announced.
 *
 * It is deliberately not the count that ended up being drawn. The announcement is
 * what selects a height on the *next* open, so the height has to be stored where
 * the next announcement will look. When the two disagree - a background card
 * dropped by the retention window, a document that retired mid-open - the next
 * open of that same state then already knows its height instead of correcting on
 * every single open.
 */
function planKeyCardCount(): number {
	return plannedCardCount() ?? renderedCardCount();
}

// The hint is a promise about the *settled* layout, and the moment the inventory
// publishes is not that moment: the last card may still be committing, and the
// first correction has not been applied yet. Writing then stored a height no
// open ever landed on, so every open reserved it, measured, and jumped - the
// flicker this whole mechanism exists to remove. Deferring one frame writes the
// layout the Popup actually kept on screen.
let persistHandle = 0;
function schedulePersist(): void {
	if (persistHandle !== 0) return;
	persistHandle = requestAnimationFrame(() => {
		persistHandle = 0;
		if (!inventoryPublished() || measuredHeight === null) return;
		persistFrameHeight(planKeyCardCount(), measuredHeight);
	});
}

// The pagehide path: a Popup can be closed between the publish and that frame,
// and losing the write would leave the next open with no hint at all.
export function flushPredictedFrameHeight(): void {
	if (persistHandle !== 0) {
		cancelAnimationFrame(persistHandle);
		persistHandle = 0;
	}
	if (!inventoryPublished() || measuredHeight === null) return;
	persistFrameHeight(planKeyCardCount(), measuredHeight);
}

// eff: sizes the document to the last settled height before the first paint
export function reservePopupFrame(): void {
	const cards = plannedCardCount();
	predictedHeight = readFrameHeight(cards);
	if (predictedHeight === null) return;
	const html = document.documentElement;
	// The render-blocking head script (`frame-reserve.js`) has already written
	// this same height, and it did so before the first paint - which is the only
	// reason the window can open at the right size instead of jumping to it.
	// Rewriting it here would be a no-op at best and, if the hint changed since,
	// would reintroduce exactly the jump the reservation exists to remove.
	const reserved = Number(html.dataset.spectraFrameReserved ?? '');
	if (Number.isFinite(reserved) && reserved > 0) return;
	html.style.height = `${predictedHeight}px`;
	// While the prediction stands in for unrendered content, the document must
	// not report a taller or shorter height than the window is already using.
	html.style.overflowY = 'hidden';
	// The head script records which key answered; this path only runs when it
	// found none, so this open is the one that has to teach the next.
	html.dataset.spectraFrameSource = 'module';
	html.dataset.spectraFrameReserved = String(predictedHeight);
}

// eff: drops the reservation so a failed bootstrap shows its own surface
export function releasePopupFrame(): void {
	stopFrameTracking();
	predictedHeight = null;
	measuredHeight = null;
	measuredOverflowY = null;
	if (persistHandle !== 0) {
		cancelAnimationFrame(persistHandle);
		persistHandle = 0;
	}
	const html = document.documentElement;
	html.classList.remove('spectra-frame-stable');
	html.style.height = '';
	html.style.overflowY = '';
	// The head script's reservation is spent; leaving the marker behind would
	// make a later reservation believe the height is already in place.
	delete html.dataset.spectraFrameReserved;
	delete html.dataset.spectraFrameSource;
}

// The inventory publishes `data-spectra-ready` once every card that will be
// rendered for this open has been committed. Until then the frame is *held* at
// the prediction: an open must never be a sequence of window sizes.
function inventoryPublished(): boolean {
	return document.documentElement.dataset.spectraReady !== undefined;
}

/**
 * The whole sizing rule: the frame is the content height, held at the
 * prediction until the inventory has published, and never past Chrome's
 * ceiling.
 *
 * While the inventory is pending the window is *pinned*, not floored. A floor
 * (`max(content, prediction)`) still lets every card that mounts push the
 * window one step taller, and that sequence of resizes is exactly the flicker:
 * the Popup opens, grows, grows again, then settles. Holding the prediction
 * means the window size changes at most once per open - when the inventory
 * publishes - and not at all when the prediction was right.
 *
 * Once the inventory has answered, a prediction that is still in force is a
 * stale height from a previous open: keeping it would leave blank space below
 * the last card whenever this open is shorter than the one before it.
 */
export function resolveFrameTarget(
	content: number,
	published: boolean,
	predicted: number | null,
): number {
	if (published) return clampFrameHeight(content);
	return clampFrameHeight(predicted ?? content);
}

// eff: retargets the frame whenever the rendered content changes height
export function trackPopupFrame(): void {
	const container = document.querySelector<HTMLElement>('.view-container');
	// Tracking is idempotent: a second call replaces the first pair instead of
	// stacking on it.
	stopFrameTracking();
	if (!container) return;
	const revision = trackingRevision;
	const html = document.documentElement;

	const apply = (): void => {
		const content = container.getBoundingClientRect().height;
		if (!Number.isFinite(content) || content <= 0) return;
		const published = inventoryPublished();
		const target = resolveFrameTarget(content, published, predictedHeight);
		// Above the ceiling the window cannot follow, so the document takes over
		// scrolling rather than hiding the cards below it. This is the whole
		// overflow policy: one scroll surface for the entire Popup, so the blank
		// under the last card is the same 24px in every state - sometimes on
		// screen, sometimes one scroll away, never silently clipped.
		const overflowY = content > FRAME_MAX_HEIGHT_PX ? 'auto' : 'hidden';
		// The target is clamped at Chrome's ceiling, so every document taller than
		// the ceiling keeps returning the same target while its content keeps
		// growing. Overflow is decided by the content, never by the target, so it
		// is compared on its own: a tall document that was first measured short
		// used to keep `hidden` and silently clip the cards below the fold.
		if (target === measuredHeight && overflowY === measuredOverflowY) {
			if (published) {
				html.classList.add('spectra-frame-stable');
				// The prediction was right, so this open has nothing to correct -
				// but the shape's height still has to be recorded, or a shape that
				// only ever opens at its predicted height would never learn it.
				schedulePersist();
			}
			return;
		}
		measuredHeight = target;
		measuredOverflowY = overflowY;
		// The publish is the only moment an open can disagree with its own
		// prediction, and it is the one moment a resize is not the user's doing.
		// Enabling the travel *before* the write means the disagreement is eased
		// instead of snapped: the window finishes settling rather than jumping.
		// With a correct hint - the common case - there is nothing to animate.
		if (published) html.classList.add('spectra-frame-stable');
		html.style.height = `${target}px`;
		html.style.overflowY = overflowY;
		// Only a frame the content can settle on is worth remembering. Persisting
		// an intermediate height - the prediction still holding the frame up, or a
		// card stack that has not finished rendering - taught the next open to
		// reserve a height this content never lands on, so every open had to jump
		// from it to the real one. The reservation is a promise about the settled
		// layout, so only the settled layout may write it.
		if (published) schedulePersist();
	};

	// Observer delivery cannot resize a shallower observed ancestor in the same
	// round. Coalesce invalidations and write root geometry at the next rendering
	// boundary; first sizing below remains synchronous. Retirement fences queued
	// callbacks even if a notification was already delivered before disconnect.
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
	// Publishing the inventory is what lifts the floor, and it writes an attribute
	// rather than changing the container's size, so the ResizeObserver above cannot
	// see it. Whatever corrected the frame anyway used to be an unrelated later
	// tick - a scrollbar appearing, a card re-laying out - which is why a short
	// Popup that followed a tall one sometimes opened with a few hundred pixels of
	// blank below its only card. Retargeting on the publish makes that correction
	// unconditional instead of lucky.
	const mutationObserver = new MutationObserver(scheduleApply);
	mutationObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-spectra-ready'],
	});
	frameObservers.replace({ resize: resizeObserver, mutation: mutationObserver });
	apply();
}
