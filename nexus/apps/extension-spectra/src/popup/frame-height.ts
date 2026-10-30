// goal: hold the Action Popup window at the height its content actually needs,
// predicting the first frame and animating every correction instead of snapping
// inv: the document height must never be the reason a card appears to move

import { logger } from '../shared/logger';

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

const FRAME_HEIGHT_KEY = 'spectra.popup.frameHeight';
// Chrome grants an Action Popup at most 600px of height. Past that the window
// stops growing, so the document has to scroll instead of clipping the cards
// that are still below the fold.
const FRAME_MAX_HEIGHT_PX = 600;
const FRAME_PERSIST_DELAY_MS = 250;

let measuredHeight: number | null = null;
let predictedHeight: number | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writePredictedFrameHeight(height);
  }, FRAME_PERSIST_DELAY_MS);
}

// eff: sizes the document to the last settled height before the first paint
export function reservePopupFrame(): void {
  predictedHeight = readPredictedFrameHeight();
  if (predictedHeight === null) return;
  const html = document.documentElement;
  html.style.height = `${predictedHeight}px`;
  // While the prediction stands in for unrendered content, the document must
  // not report a taller or shorter height than the window is already using.
  html.style.overflowY = 'hidden';
}

// eff: drops the reservation so a failed bootstrap shows its own surface
export function releasePopupFrame(): void {
  predictedHeight = null;
  measuredHeight = null;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const html = document.documentElement;
  html.style.height = '';
  html.style.overflowY = '';
}

// The inventory publishes `data-spectra-ready` once every card that will be
// rendered for this open has been committed. Until then the predicted height is
// a floor: the window may grow into the real layout but must never shrink back
// through an intermediate, half-populated measurement.
function inventoryPublished(): boolean {
  return document.documentElement.dataset.spectraReady !== undefined;
}

// eff: retargets the frame whenever the rendered content changes height
export function trackPopupFrame(): void {
  const container = document.querySelector<HTMLElement>('.view-container');
  if (!container) return;
  const html = document.documentElement;

  const apply = (): void => {
    const content = container.getBoundingClientRect().height;
    if (!Number.isFinite(content) || content <= 0) return;
    const floor = inventoryPublished() ? 0 : (predictedHeight ?? 0);
    const target = clampFrameHeight(Math.max(content, floor));
    if (target === measuredHeight) return;
    measuredHeight = target;
    html.style.height = `${target}px`;
    // Above the ceiling the window cannot follow, so the document takes over
    // scrolling rather than hiding the cards below it.
    html.style.overflowY = content > FRAME_MAX_HEIGHT_PX ? 'auto' : 'hidden';
    schedulePersist(target);
  };

  new ResizeObserver(apply).observe(container);
  apply();
}
