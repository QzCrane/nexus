// goal: SidePanel early init (theme + smooth scroll) - CSP compliant
// inv: Runs before React, scroll logic in sidepanel-scroll.ts

// ===== Theme =====
const DARK = {
	'--halo-bg': '#1a1a1a',
	'--halo-bg-secondary': '#242424',
	'--halo-bg-tertiary': '#2a2a2a',
	'--halo-text': '#f0f0f0',
	'--halo-text-secondary': '#b0b0b0',
	'--halo-text-muted': '#666666',
	'--halo-border': '#444444',
};

const LIGHT = {
	'--halo-bg': '#ffffff',
	'--halo-bg-secondary': '#f5f5f5',
	'--halo-bg-tertiary': '#eeeeee',
	'--halo-text': '#1a1a1a',
	'--halo-text-secondary': '#555555',
	'--halo-text-muted': '#888888',
	'--halo-border': '#dddddd',
};

function initTheme(): void {
	const applyTheme = (mode: unknown): void => {
		const isDark =
			mode === 'dark' ||
			(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		const colors = isDark ? DARK : LIGHT;
		for (const [key, value] of Object.entries(colors)) {
			document.documentElement.style.setProperty(key, value);
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

// Execute
initTheme();

import { initScroll } from './sidepanel-scroll';
initScroll();

// Sync SaaT tools
import { syncSaaTTools } from '../kernel/services/saat-service';
import { TOOL_REGISTRY } from '../kernel/registry/tool-registry';

syncSaaTTools(TOOL_REGISTRY).catch(e => console.error('SaaT Sync Failed:', e));
