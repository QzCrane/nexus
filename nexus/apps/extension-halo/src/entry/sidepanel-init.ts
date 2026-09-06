// goal: SidePanel early init (theme + smooth scroll) - CSP compliant
// inv: Keep the pre-React critical path limited to paint/input initialization.

// ===== Theme =====
import { THEME_SURFACES } from '../kernel/core/theme-palette';

function initTheme(): void {
	const applyTheme = (mode: unknown): void => {
		const isDark =
			mode === 'dark' ||
			(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		const colors = isDark ? THEME_SURFACES.dark : THEME_SURFACES.light;
		for (const [key, value] of Object.entries(colors)) {
			document.documentElement.style.setProperty(`--halo-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
		}
	};

	applyTheme('dark');
	try {
		void chrome.storage.sync.get(['HALO_SETTINGS'])
			.then((result) => {
				const settings = result.HALO_SETTINGS;
				applyTheme(
					typeof settings === 'object' && settings !== null
						? (settings as { theme?: unknown }).theme
						: 'dark',
				);
			})
			.catch((error: unknown) => {
				console.warn('[HALO:Theme] Failed to load persisted theme', error);
			});
	} catch (error: unknown) {
		console.warn('[HALO:Theme] Storage context unavailable', error);
	}
}

initTheme();

import { initScroll } from './sidepanel-scroll';
initScroll();
