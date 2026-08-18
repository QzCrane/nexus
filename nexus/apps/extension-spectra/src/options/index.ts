// goal: entry point for the SPECTRA settings page, coordinating theme, i18n, and editor module initialization

import { initTheme } from './theme';
import { initI18n } from './i18n';
import { initSlotsEditor } from './slots-editor';
import { initSiteEditor } from './site-editor';
import { initModal } from './modal';
import { initUserScriptsSection } from './userscripts';
import { initDiagnosticsSection } from './diagnostics';
import { installOptionsOptionalPermissionAdmission } from './optional-permission-ui';
import { enableSmoothScroll } from '../shared/smooth-scroll';
import { bindOptionsRetry, clearOptionsError, showOptionsError } from './status';

// eff: initializes global page behaviors and sub-modules in sequence
async function init(): Promise<void> {
	clearOptionsError();
	enableSmoothScroll();
	await initTheme();

	await initI18n();
	initModal();
	const disposeOptionalPermissionAdmission = installOptionsOptionalPermissionAdmission();
	window.addEventListener('pagehide', disposeOptionalPermissionAdmission, { once: true });

	await initSlotsEditor();
	await initSiteEditor();
	await initUserScriptsSection();
	initDiagnosticsSection();

	const link = document.getElementById('chrome-shortcuts-link');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			// note: browser security prevents direct navigation to chrome:// urls via href; must use chrome.tabs.create
			chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	bindOptionsRetry();
	void init().catch(showOptionsError);
});
