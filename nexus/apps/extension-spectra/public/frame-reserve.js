// goal: decide the Action Popup's theme and height before the browser's first paint
//
// Chrome sizes the Action Popup window from the document, and the popup module
// (`popup.js`) is a `type="module"` script: modules are deferred, so they run
// after the document has been parsed - which is also the earliest moment the
// browser may paint it. Deciding anything from inside the module therefore
// always arrived one frame too late, and that one frame is what the user saw:
// the window shown at the empty document's height and then jumping to the real
// one, and a light-theme surface repainted dark once settings resolved.
//
// This file is a classic render-blocking script. It runs while the head is
// still being parsed, so the very first frame is already the right colour at
// the right size. It is an external file rather than an inline block because an
// MV3 extension page's CSP forbids inline script.
//
// Nothing is measured here. The height is looked up from what earlier opens of
// the same shape recorded, keyed by the card count the Background announces in
// this document's URL - the one piece of layout the Background knows before the
// document exists. The config below is injected by the build from
// `src/shared/popup-bootstrap.ts`, so this file can never read a key the Popup
// module does not write.
(() => {
  let config;
  try {
    config = JSON.parse('__SPECTRA_POPUP_BOOTSTRAP__');
  } catch {
    // A dist that was never injected must not take the Popup down with it: the
    // module still sizes and themes the Popup, one frame later than ideal.
    return;
  }
  if (!config) return;
  const html = document.documentElement;

  // A denied storage area costs the reservation, never the Popup.
  const readHint = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  // 1. The theme. Settings arrive long after the first paint, so the last
  //    committed mode is the only authority available here. `system` is
  //    resolved from the same media query the module uses.
  const mode = readHint(config.themeKey);
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode !== 'light' && systemDark);
  html.setAttribute('data-theme', dark ? 'dark' : 'light');

  // 2. Which surface this is. `accessibility.css` reflows pages opened in a
  //    tab; the Action Popup must keep its intrinsic width. The module sets the
  //    same attribute, but only after the first paint could have happened.
  const isActionPopup = () => {
    try {
      const views = chrome.extension.getViews({ type: 'popup' });
      return Boolean(views) && views.indexOf(window) !== -1;
    } catch {
      // No extension API at parse time: the module still sets it.
      return false;
    }
  };
  if (isActionPopup()) html.setAttribute('data-spectra-surface', config.surface);

  // 3. The frame. The count travels in the URL because it is the only thing
  //    that differs between opens of the same Popup; the height for that count
  //    is what previous opens settled on.
  const reservation = () => {
    const cards = new URLSearchParams(window.location.search).get(config.param);
    const keys = [];
    if (cards !== null && /^\d{1,3}$/u.test(cards)) keys.push(`${config.prefix}.${cards}`);
    keys.push(config.lastKey, config.legacyKey);
    for (const key of keys) {
      const stored = Number(readHint(key));
      if (!Number.isFinite(stored) || stored <= 0) continue;
      return {
        height: Math.max(0, Math.min(Math.round(stored), config.maxHeight)),
        key,
      };
    }
    // No hint is a legal state: this open grows into place and teaches the next.
    return null;
  };
  const settled = reservation();
  if (settled === null) return;
  html.style.height = `${settled.height}px`;
  // While the prediction stands in for content that is not rendered yet, the
  // document must not report a height the window is not already using.
  html.style.overflowY = 'hidden';
  html.setAttribute('data-spectra-frame-reserved', String(settled.height));
  // Which key answered: the integration spec asserts the shape's own entry was
  // used, not a neighbour's that happened to be close enough.
  html.setAttribute('data-spectra-frame-source', settled.key);
})();
