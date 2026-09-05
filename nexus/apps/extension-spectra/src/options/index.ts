// goal: entry point for the SPECTRA settings page, coordinating theme, i18n, and editor module initialization

import { initTheme } from './theme';
import { initI18n } from './i18n';
import { initSlotsEditor, projectSlotsEditor } from './slots-editor';
import { initSiteEditor, projectSiteEditor } from './site-editor';
import { initModal } from './modal';
import { initUserScriptsSection } from './userscripts';
import { enableSmoothScroll } from '../shared/smooth-scroll';
import { bindOptionsRetry, clearOptionsError, showOptionsError } from './status';
import {
	getOptionsSettingsSnapshot,
	subscribeOptionsSettingsSnapshots,
} from '../shared/options-settings-client';

// eff: initializes global page behaviors and sub-modules in sequence
async function init(): Promise<void> {
	clearOptionsError();
	enableSmoothScroll();
	await initTheme();

	await initI18n();
	initModal();

	const initialSettings = await getOptionsSettingsSnapshot();
	await initSlotsEditor(initialSettings);
	await initSiteEditor(initialSettings);
	await initUserScriptsSection();

	let projectedSettingsRevision = initialSettings.revision;
	const unsubscribeSettings = subscribeOptionsSettingsSnapshots((snapshot) => {
		if (snapshot.revision <= projectedSettingsRevision) return;
		projectedSettingsRevision = snapshot.revision;
		projectSiteEditor(snapshot);
		projectSlotsEditor(snapshot);
	});
	window.addEventListener('pagehide', () => {
		unsubscribeSettings();
	}, { once: true });

	const link = document.getElementById('chrome-shortcuts-link');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			// note: browser security prevents direct navigation to chrome:// urls via href; must use chrome.tabs.create
			void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(showOptionsError);
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	bindOptionsRetry();
	void init().catch(showOptionsError);
});
