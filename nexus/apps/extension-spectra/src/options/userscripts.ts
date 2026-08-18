// goal: owns optional userScripts permission admission plus Chrome's separate platform enablement gate

import { hasOptionalPermission, requestOptionalPermission } from '../shared/optional-permission-admission';
import { t } from './i18n';

// eff: checks both the optional permission and Chrome's Developer Mode / Allow User Scripts platform gate
async function checkUserScriptsAvailable(): Promise<boolean> {
	try {
		if (!await hasOptionalPermission('userScripts')) return false;
		await chrome.userScripts.getScripts();
		return true;
	} catch {
		return false;
	}
}

// eff: updates the status badge UI based on complete userScripts availability
async function updateStatusBadge(): Promise<void> {
	const badge = document.getElementById('userscripts-status');
	if (!badge) return;

	const available = await checkUserScriptsAvailable();

	if (available) {
		badge.textContent = t('opt_userscripts_status_enabled');
		badge.className = 'status-badge enabled';
	} else {
		badge.textContent = t('opt_userscripts_status_disabled');
		badge.className = 'status-badge disabled';
	}
}

// eff: opens the extension details page where Chrome 138+ exposes Allow User Scripts
// and older supported Chrome exposes the Developer Mode prerequisite.
function openExtensionSettings(): void {
	const extensionId = chrome.runtime.id;
	void chrome.tabs.create({ url: `chrome://extensions/?id=${extensionId}` });
}

async function requestUserScriptsCapability(): Promise<void> {
	// requestOptionalPermission stays directly under this click path; Background
	// never requests optional permissions and only consumes already granted APIs.
	let granted = false;
	try {
		granted = await requestOptionalPermission('userScripts');
	} catch {
		granted = false;
	}
	if (!granted) {
		await updateStatusBadge();
		return;
	}
	if (!await checkUserScriptsAvailable()) openExtensionSettings();
	await updateStatusBadge();
}

// eff: initializes the userScripts section with one explicit permission owner and status recovery
export async function initUserScriptsSection(): Promise<void> {
	await updateStatusBadge();

	const enableBtn = document.getElementById('userscripts-enable-btn');
	enableBtn?.addEventListener('click', () => {
		void requestUserScriptsCapability();
	});

	// note: re-check status when window regains focus (user may have enabled the platform toggle)
	window.addEventListener('focus', () => {
		void updateStatusBadge();
	});
}
