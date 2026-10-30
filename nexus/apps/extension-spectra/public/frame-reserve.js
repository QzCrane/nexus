// goal: reserve the Action Popup's height before the browser's first paint
//
// Chrome sizes the Action Popup window from the document, and the popup module
// (`popup.js`) is a `type="module"` script: modules are deferred, so they run
// after the document has been parsed - which is also the earliest moment the
// browser may paint it. Reserving the height from inside the module therefore
// always arrived one frame too late: the window was first shown at the empty
// document's height and then jumped to the reserved one, on every open.
//
// This file is a classic render-blocking script. It runs while the head is
// still being parsed, long before the first paint, so the very first frame the
// user can see is already the height the previous open settled on. It is an
// external file rather than an inline block because an MV3 extension page's
// content security policy forbids inline script.
//
// It reads the same hint key as `src/popup/frame-height.ts` and writes nothing,
// so the reservation and the module's own bookkeeping can never disagree.
(() => {
  // Chrome grants an Action Popup at most 600px of height; past it the
  // document scrolls instead of the window growing.
  const maxHeight = 600;
  const html = document.documentElement;
  const storage = window.localStorage;
  const raw = storage ? storage.getItem('spectra.popup.frameHeight') : null;
  if (raw === null) return;
  const stored = Number(raw);
  if (!Number.isFinite(stored) || stored <= 0) return;
  const height = Math.max(0, Math.min(Math.round(stored), maxHeight));
  html.style.height = `${height}px`;
  // While the prediction stands in for content that is not rendered yet, the
  // document must not report a height the window is not already using.
  html.style.overflowY = 'hidden';
  html.setAttribute('data-spectra-frame-reserved', String(height));
})();
