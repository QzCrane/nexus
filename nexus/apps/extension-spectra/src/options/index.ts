/**
 * SPECTRA Options - Main Entry
 *
 * Configures Chrome Slots, Site Settings, I18n, and Theme.
 */

import { initTheme } from './theme';
import { initI18n } from './i18n';
import { initSlotsEditor } from './slots-editor';
import { initSiteEditor } from './site-editor';
import { initModal } from './modal';
import { enableSmoothScroll } from '../shared/smooth-scroll';

async function init(): Promise<void> {
	console.log('[SPECTRA] Options page initializing...');

	// Mac-style Smooth Scroll
	enableSmoothScroll();

	initTheme();

	await initI18n();

	initModal();

	await initSlotsEditor();

	await initSiteEditor();

	// Chrome shortcuts link
	const link = document.getElementById('chrome-shortcuts-link');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
		});
	}

	console.log('[SPECTRA] Options page ready');
}

document.addEventListener('DOMContentLoaded', init);
