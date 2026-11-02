// goal: commit the theme and Action surface before the browser's first paint
// Card slots come from popup-first-paint.js. Their intrinsic CSS size owns the
// initial frame; a previous open's height is never consulted.
(() => {
  let config;
  try {
    config = JSON.parse('__SPECTRA_POPUP_BOOTSTRAP__');
  } catch {
    // An uninjected development asset must not prevent Popup startup.
    return;
  }
  if (!config) return;
  const html = document.documentElement;
  let mode;
  try {
    mode = window.localStorage.getItem(config.themeKey);
  } catch {
    // A denied storage area only loses the stored theme preference.
    mode = null;
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode !== 'light' && systemDark);
  html.setAttribute('data-theme', dark ? 'dark' : 'light');

  // Tab-hosted extension pages may reflow; Action Popup keeps intrinsic width.
  try {
    if (chrome.extension.getViews({ type: 'popup' }).includes(window)) {
      html.setAttribute('data-spectra-surface', config.surface);
    }
  } catch {
    // The module can establish the surface if the parse-time API is unavailable.
    return;
  }
})();
