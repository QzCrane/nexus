// goal: hold the Action Popup window at the height its content actually needs,
// predicting the first frame and animating every correction instead of snapping
// inv: the document height must never be the reason a card appears to move

import { logger } from '../shared/logger';
import { FRAME_HEIGHT_KEY } from './constants/frame-height';
import { createFrameObserverHolder } from './frame-observers';

// Chrome sizes an Action Popup window from the document, and the document is a
// brand new realm on every open. Nothing that decides the layout - the tab
// inventory, each card's control snapshot - is available synchronously, so a
// content-derived height always settles after the first paint. Left alone that
// surfaces as two window resizes in front of the user: one when the active-tab
// card commits, another when the background list lands.
//
// Two mechanisms remove both. The last settled height is replayed before the
// first paint, so the common case opens already correct; every later
// correction is retargeted through a CSS height transition, which Chrome
// follows frame by frame (measured: 57 distinct window heights across a single
// 600ms tween). A prediction that is too small is held as a floor until the
// inventory is published, so the window can never dip before it grows.

// Chrome grants an Action Popup at most 600px of height, and no layout can
// change that. Above it the Popup scrolls as one document rather than giving
// the background list its own scroll area: a single scroll surface keeps the
// blank under the last card at the end of the same gesture that reveals that
// card, whereas a nested list would need a second gesture inside a boundary of
// its own and would clip its cards there instead of at the window.
const FRAME_MAX_HEIGHT_PX = 600;

let measuredHeight: number | null = null;
let measuredOverflowY: string | null = null;
let predictedHeight: number | null = null;
// The observers are the frame's only continuous presence in the document. A
// Popup that retries its bootstrap would stack a second pair on the same
// container, and a released frame would still be re-sized by the pair that was
// never disconnected - which is how a failed bootstrap ended up with the
// reservation painted back over the error surface.
const frameObservers = createFrameObserverHolder();

function clampFrameHeight(value: number): number {
  return Math.max(0, Math.min(Math.round(value), FRAME_MAX_HEIGHT_PX));
}

// note: this hint is the only layout fact the Popup can read synchronously. It
// is a rendering hint, never state: losing it costs one animated correction.
function readPredictedFrameHeight(): number | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FRAME_HEIGHT_KEY);
  } catch (error) {
    logger.popup.debug('[Popup] frame height hint unreadable', error);
    return null;
  }
  if (raw === null) return null;
  const stored = Number(raw);
  return Number.isFinite(stored) && stored > 0 ? clampFrameHeight(stored) : null;
}

function writePredictedFrameHeight(height: number): void {
  try {
    window.localStorage.setItem(FRAME_HEIGHT_KEY, String(height));
  } catch (error) {
    // note: a denied storage area only costs the next open one re-measure
    logger.popup.debug('[Popup] frame height hint not persisted', error);
  }
}

function schedulePersist(height: number): void {
  // This is one small synchronous write. Debouncing it used to lose the height
  // whenever the user reopened quickly, because a Popup closes long before the
  // old 250ms timer fired.
  writePredictedFrameHeight(height);
}

// eff: sizes the document to the last settled height before the first paint
export function reservePopupFrame(): void {
  predictedHeight = readPredictedFrameHeight();
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
}

// eff: drops the reservation so a failed bootstrap shows its own surface
export function releasePopupFrame(): void {
	frameObservers.release();
	predictedHeight = null;
	measuredHeight = null;
	measuredOverflowY = null;
  const html = document.documentElement;
  html.classList.remove('spectra-frame-stable');
  html.style.height = '';
  html.style.overflowY = '';
  // The head script's reservation is spent; leaving the marker behind would
  // make a later reservation believe the height is already in place.
  delete html.dataset.spectraFrameReserved;
}

// The inventory publishes `data-spectra-ready` once every card that will be
// rendered for this open has been committed. Until then the predicted height is
// a floor: the window may grow into the real layout but must never shrink back
// through an intermediate, half-populated measurement.
function inventoryPublished(): boolean {
  return document.documentElement.dataset.spectraReady !== undefined;
}

/**
 * The whole sizing rule: the frame is the content height, held up by the
 * prediction until the inventory has published, and never past Chrome's ceiling.
 *
 * The prediction exists only to cover the gap before the inventory answers. Once
 * it has answered, a prediction that is still in force is simply a stale height
 * from a previous open: keeping it would leave blank space below the last card
 * whenever this open is shorter than the one before it.
 */
export function resolveFrameTarget(
  content: number,
  published: boolean,
  predicted: number | null,
): number {
  const floor = published ? 0 : (predicted ?? 0);
  return clampFrameHeight(Math.max(content, floor));
}

// eff: retargets the frame whenever the rendered content changes height
export function trackPopupFrame(): void {
	const container = document.querySelector<HTMLElement>('.view-container');
	// Tracking is idempotent: a second call replaces the first pair instead of
	// stacking on it.
	frameObservers.release();
	if (!container) return;
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
      if (published && !html.classList.contains('spectra-frame-stable')) {
        requestAnimationFrame(() => {
          html.classList.add('spectra-frame-stable');
        });
      }
      return;
    }
    measuredHeight = target;
    measuredOverflowY = overflowY;
    html.style.height = `${target}px`;
    html.style.overflowY = overflowY;
    // Only a frame the content can settle on is worth remembering. Persisting
    // an intermediate height - the prediction still holding the frame up, or a
    // card stack that has not finished rendering - taught the next open to
    // reserve a height this content never lands on, so every open had to jump
    // from it to the real one. The reservation is a promise about the settled
    // layout, so only the settled layout may write it.
    if (published) {
      schedulePersist(target);
      // Once the settled published frame is applied without transitions, enable
      // transition for subsequent runtime layout mutations (side-panel, etc.) on next frame.
      if (!html.classList.contains('spectra-frame-stable')) {
        requestAnimationFrame(() => {
          html.classList.add('spectra-frame-stable');
        });
      }
    }
  };

	const resizeObserver = new ResizeObserver(apply);
	resizeObserver.observe(container);
	// Publishing the inventory is what lifts the floor, and it writes an attribute
	// rather than changing the container's size, so the ResizeObserver above cannot
	// see it. Whatever corrected the frame anyway used to be an unrelated later
	// tick - a scrollbar appearing, a card re-laying out - which is why a short
	// Popup that followed a tall one sometimes opened with a few hundred pixels of
	// blank below its only card. Retargeting on the publish makes that correction
	// unconditional instead of lucky.
	const mutationObserver = new MutationObserver(apply);
	mutationObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-spectra-ready'],
	});
	frameObservers.replace({ resize: resizeObserver, mutation: mutationObserver });
	apply();
}
