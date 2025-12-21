/**
 * SPECTRA Popup - 视图导航逻辑
 */

import { $, $required } from '../utils/dom';
import { UI_SIZES } from '../constants';
import { cardRenderCallbacks } from '../views/settings';

/** 视图导航状态 */
interface NavigationState {
  viewMain: HTMLElement;
  viewSettings: HTMLElement;
  viewContainer: HTMLElement;
}

/** 初始化视图导航 */
export function initNavigation(): NavigationState {
  const viewMain = $required<HTMLElement>('view-main');
  const viewSettings = $required<HTMLElement>('view-settings');
  const viewContainer = document.querySelector('.view-container') as HTMLElement;

  const btnSettings = $<HTMLElement>('btn-settings');
  const btnBack = $<HTMLElement>('btn-back');
  const btnShortcuts = $<HTMLElement>('btn-shortcuts');

  // 快捷键设置按钮
  if (btnShortcuts) {
    btnShortcuts.onclick = () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    };
  }

  // 进入设置页
  if (btnSettings) {
    btnSettings.onclick = () => {
      const mainHeight = viewMain.offsetHeight;

      viewMain.classList.remove('active');
      viewSettings.classList.add('active');

      // 如果主 UI 高度小于设置页所需高度，则展开
      if (mainHeight < UI_SIZES.SETTINGS_MIN_HEIGHT) {
        viewContainer.style.minHeight = `${UI_SIZES.SETTINGS_MIN_HEIGHT}px`;
      }
    };
  }

  // 返回主页
  if (btnBack) {
    btnBack.onclick = () => {
      viewSettings.classList.remove('active');
      viewMain.classList.add('active');
      // 恢复原始高度
      viewContainer.style.minHeight = '';

      // 触发所有卡片重绘，确保设置变更立即生效
      // 这解决了修改频谱开关后返回时 UI 不同步的问题
      requestAnimationFrame(() => {
        cardRenderCallbacks.forEach((cb) => cb());
      });
    };
  }

  return { viewMain, viewSettings: viewSettings, viewContainer };
}

