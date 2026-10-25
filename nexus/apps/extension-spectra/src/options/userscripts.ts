// goal: manages the userScripts API availability check and UI updates on options page

import { t } from './i18n';
import { showOptionsError } from './status';
import { requestOptionalPermission } from '../shared/optional-permission-admission';

let focusListener: (() => void) | null = null;
let listenersBound = false;
let retired = false;

// eff: checks if userScripts API is available and enabled
async function checkUserScriptsAvailable(): Promise<boolean> {
	try {
		await chrome.userScripts.getScripts();
		return true;
	} catch {
		return false;
	}
}

// eff: updates the status badge UI based on userScripts availability
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

// eff: opens the extension details page where user can enable userScripts
function openExtensionSettings(): void {
	const extensionId = chrome.runtime.id;
	// note: Chrome 138+ uses Allow User Scripts toggle on extension details page
	void chrome.tabs.create({ url: `chrome://extensions/?id=${extensionId}` }).catch(showOptionsError);
}

// eff: initializes the userScripts section with event listeners and status check
// inv: retry re-reads the live badge but never duplicates the enable/focus/pagehide listeners
export async function initUserScriptsSection(): Promise<void> {
	await updateStatusBadge();
	if (listenersBound) return;
	listenersBound = true;

	const enableBtn = document.getElementById('userscripts-enable-btn');
	let pending = false;
	if (enableBtn instanceof HTMLElement) {
		enableBtn.onclick = () => {
			if (retired || pending) return;
			pending = true;
			try {
				void requestOptionalPermission('userScripts').then((granted) => {
					if (retired) return;
					if (granted) openExtensionSettings();
					else showOptionsError(new Error('User Scripts permission was not granted.'));
				}).catch((error: unknown) => {
					if (!retired) showOptionsError(error);
				}).finally(() => { pending = false; });
			} catch (error) {
				pending = false;
				showOptionsError(error);
			}
		};
	}

	// note: re-check status when window regains focus (user may have enabled it)
	focusListener = () => {
		void updateStatusBadge().catch(showOptionsError);
	};
	window.addEventListener('focus', focusListener);
	window.addEventListener('pagehide', () => {
		retired = true;
		if (enableBtn instanceof HTMLElement) enableBtn.onclick = null;
		if (focusListener) window.removeEventListener('focus', focusListener);
		focusListener = null;
	}, { once: true });
}
