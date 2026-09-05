// goal: manages transitions between the main control view and the settings panel within the popup

import { $, $required } from '../utils/dom';
import { cardRenderCallbacks } from '../views/settings';
import { showPopupToast } from '../toast';

interface NavigationState {
	viewMain: HTMLElement;
	viewSettings: HTMLElement;
	viewContainer: HTMLElement;
}

// eff: initializes click handlers and selects the CSS-owned intrinsic/settings sizing mode
export function initNavigation(): NavigationState {
	const viewMain = $required<HTMLElement>('view-main');
	const viewSettings = $required<HTMLElement>('view-settings');
	const viewContainer = document.querySelector('.view-container') as HTMLElement;

	const btnSettings = $<HTMLElement>('btn-settings');
	const btnBack = $<HTMLElement>('btn-back');
	const btnHotkeys = $<HTMLElement>('btn-hotkeys');
	const btnShortcuts = $<HTMLElement>('btn-shortcuts');

	setViewActive(viewMain, true);
	setViewActive(viewSettings, false);
	viewContainer.classList.remove('settings-view-active');

	if (btnHotkeys) {
		btnHotkeys.onclick = () => {
			void chrome.runtime.openOptionsPage().catch((error: unknown) => {
				showPopupToast(error instanceof Error ? error.message : String(error), 'error');
			});
		};
	}

	if (btnShortcuts) {
		btnShortcuts.onclick = () => {
			void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch((error: unknown) => {
				showPopupToast(error instanceof Error ? error.message : String(error), 'error');
			});
		};
	}

	if (btnSettings) {
		btnSettings.onclick = () => {
			setViewActive(viewSettings, true);
			viewContainer.classList.add('settings-view-active');
			btnBack?.focus();
			setViewActive(viewMain, false);
		};
	}

	if (btnBack) {
		btnBack.onclick = () => {
			setViewActive(viewMain, true);
			viewContainer.classList.remove('settings-view-active');
			btnSettings?.focus();
			setViewActive(viewSettings, false);

			// note: trigger rerender of all cards on return to main view to ensure UI state (sliders, toggles) is perfectly synced
			requestAnimationFrame(() => {
				cardRenderCallbacks.forEach((cb) => {
					cb();
				});
			});
		};
	}

	return { viewMain, viewSettings: viewSettings, viewContainer };
}

function setViewActive(view: HTMLElement, active: boolean): void {
	view.classList.toggle('active', active);
	view.hidden = !active;
	view.setAttribute('aria-hidden', String(!active));
	view.toggleAttribute('inert', !active);
}
