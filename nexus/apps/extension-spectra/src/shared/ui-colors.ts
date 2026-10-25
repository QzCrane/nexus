// goal: single SPECTRA presentation palette, independent from audio processing
// inv: surfaces that live outside the themed document (content shadow roots,
// canvas fallbacks, SVG data URLs) read their literals from this one owner.

export const UI_COLORS = {
	// Purple is reserved for an acknowledged active Capture processor.
	CAPTURE: '#7c3aed',
	NATIVE: '#2563eb',
	MUTED: '#9ca3af',
	DISABLED: '#94a3b8',
	WHITE: '#ffffff',
	// Confirmed speed OSD tone.
	SUCCESS: '#10b981',
	// Idle visualizer ticks while the processor warms up or the media is silent.
	VIZ_IDLE: 'rgba(148, 163, 184, 0.28)',
	// Video dim overlay regions are intentionally theme-independent.
	OVERLAY_DIM: '#000000',
	// QR modules need absolute contrast, not a theme token.
	QR_DARK: '#1a1a2e',
	QR_LIGHT: '#ffffff',
	// Toast renders in a page-owned shadow root and cannot read extension CSS.
	TOAST_SURFACE: 'rgba(20, 20, 30, 0.92)',
	TOAST_TEXT: '#ffffff',
	TOAST_SHADOW: 'rgba(0, 0, 0, 0.3)',
	TOAST_BORDER: 'rgba(255, 255, 255, 0.1)',
	// OSD pill: a dark instrument surface over arbitrary page content.
	OSD_SURFACE: 'rgba(20, 20, 30, 0.85)',
	OSD_TRACK: 'rgba(255, 255, 255, 0.2)',
	OSD_MARK: 'rgba(255, 255, 255, 0.72)',
	OSD_MARK_LABEL: 'rgba(255, 255, 255, 0.76)',
} as const;
