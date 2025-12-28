/**
 * SPECTRA Popup - View Navigation
 */

import { $, $required } from '../utils/dom';
import { UI_SIZES } from '../constants';
import { cardRenderCallbacks } from '../views/settings';

interface NavigationState {
  viewMain: HTMLElement;
  viewSettings: HTMLElement;
  viewContainer: HTMLElement;
}

export function initNavigation(): NavigationState {
  const viewMain = $required<HTMLElement>('view-main');
  const viewSettings = $required<HTMLElement>('view-settings');
  const viewContainer = document.querySelector('.view-container') as HTMLElement;

  const btnSettings = $<HTMLElement>('btn-settings');
  const btnBack = $<HTMLElement>('btn-back');
  const btnHotkeys = $<HTMLElement>('btn-hotkeys');
  const btnShortcuts = $<HTMLElement>('btn-shortcuts');

  if (btnHotkeys) {
    btnHotkeys.onclick = () => {
      chrome.runtime.openOptionsPage();
    };
  }

  if (btnShortcuts) {
    btnShortcuts.onclick = () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    };
  }

  if (btnSettings) {
    btnSettings.onclick = () => {
      const mainHeight = viewMain.offsetHeight;

      viewMain.classList.remove('active');
      viewSettings.classList.add('active');

      if (mainHeight < UI_SIZES.SETTINGS_MIN_HEIGHT) {
        viewContainer.style.minHeight = `${UI_SIZES.SETTINGS_MIN_HEIGHT}px`;
      }
    };
  }

  if (btnBack) {
    btnBack.onclick = () => {
      viewSettings.classList.remove('active');
      viewMain.classList.add('active');
      viewContainer.style.minHeight = '';

      // Force rerender to sync UI state
      requestAnimationFrame(() => {
        cardRenderCallbacks.forEach((cb) => cb());
      });
    };
  }

  return { viewMain, viewSettings: viewSettings, viewContainer };
}

