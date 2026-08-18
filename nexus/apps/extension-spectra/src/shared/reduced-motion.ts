// goal: one extension-page owner for reduced-motion semantics across Popup and Options
// inv: user preference disables decorative motion without changing control state or visibility

const STYLE_ID = 'spectra-reduced-motion-policy';

const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto !important;
  }

  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-delay: 0ms !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-delay: 0ms !important;
    transition-duration: 0.001ms !important;
  }
}
`;

export function installReducedMotionPolicy(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = REDUCED_MOTION_CSS;
	document.head.appendChild(style);
}
