// goal: entry point for the SPECTRA settings page, coordinating theme, i18n, and editor module initialization

import { initTheme } from './theme';
import { initI18n } from './i18n';
import { initSlotsEditor, projectSlotsEditor } from './slots-editor';
import { initSiteEditor, projectSiteEditor } from './site-editor';
import { initModal } from './modal';
import { initUserScriptsSection } from './userscripts';
import { initDiagnosticsSection } from './diagnostics';
import { installOptionsOptionalPermissionAdmission } from './optional-permission-ui';
import { disableSmoothScroll, enableSmoothScroll } from '../shared/smooth-scroll';
import { installAccessibilityPolicy } from '../shared/accessibility';
import { bindOptionsRetry, clearOptionsError, showOptionsError } from './status';
import {
	getOptionsSettingsSnapshot,
	subscribeOptionsSettingsSnapshots,
} from '../shared/options-settings-client';

// Retry ownership: a failed start may leave only part of the page initialized.
// Each module below guards its own static listeners, while this entry keeps the
// live settings projection and optional-permission admission disposable so the
// retry re-runs the real bootstrap instead of reloading the document.
let settingsUnsubscribe: (() => void) | null = null;
let disposeOptionalPermissionAdmission: (() => void) | null = null;

function disposeOptionsRuntime(): void {
	settingsUnsubscribe?.();
	settingsUnsubscribe = null;
	disposeOptionalPermissionAdmission?.();
	disposeOptionalPermissionAdmission = null;
}

// eff: runs the complete Options bootstrap and can be re-entered by the retry action
async function startOptions(): Promise<void> {
	try {
		disposeOptionsRuntime();
		clearOptionsError();
		await installAccessibilityPolicy();
		enableSmoothScroll();
		await initTheme();

		await initI18n();
		initModal();
		disposeOptionalPermissionAdmission = installOptionsOptionalPermissionAdmission();

		const initialSettings = await getOptionsSettingsSnapshot();
		await initSlotsEditor(initialSettings);
		await initSiteEditor(initialSettings);
		await initUserScriptsSection();
		initDiagnosticsSection();

		let projectedSettingsRevision = initialSettings.revision;
		settingsUnsubscribe = subscribeOptionsSettingsSnapshots((snapshot) => {
			if (snapshot.revision <= projectedSettingsRevision) return;
			projectedSettingsRevision = snapshot.revision;
			projectSiteEditor(snapshot);
			projectSlotsEditor(snapshot);
		});

		const link = document.getElementById('chrome-shortcuts-link');
		if (link) {
			link.onclick = (e) => {
				e.preventDefault();
				// note: browser security prevents direct navigation to chrome:// urls via href; must use chrome.tabs.create
				void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(showOptionsError);
			};
		}

		// Exact UI readiness boundary for accessibility/performance browser evidence.
		document.documentElement.dataset.spectraReady = 'true';
	} catch (error) {
		showOptionsError(error);
	}
}

window.addEventListener('pagehide', () => {
	disposeOptionsRuntime();
	disableSmoothScroll();
}, { once: true });

document.addEventListener('DOMContentLoaded', () => {
	bindOptionsRetry(() => {
		clearOptionsError();
		void startOptions();
	});
	void startOptions();
});
