// goal: owns optional userScripts permission admission plus Chrome's separate platform enablement gate

import { t } from './i18n';

const USER_SCRIPTS_PERMISSION = 'userScripts' as const;

async function hasUserScriptsPermission(): Promise<boolean> {
	try {
		return await chrome.permissions.contains({ permissions: [USER_SCRIPTS_PERMISSION] });
	} catch {
		return false;
	}
}

// eff: checks both the optional permission and Chrome's Developer Mode / Allow User Scripts platform gate
async function checkUserScriptsAvailable(): Promise<boolean> {
	if (!await hasUserScriptsPermission()) return false;
	try {
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
	// chrome.permissions.request must remain the first asynchronous capability
	// boundary inside this click handler so the request is attributable to the
	// user's explicit feature-enable gesture.
	let granted = false;
	try {
		granted = await chrome.permissions.request({ permissions: [USER_SCRIPTS_PERMISSION] });
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
