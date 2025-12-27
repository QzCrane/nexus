/**
 * SPECTRA Popup - 主入口
 * 
 * 整合所有模块，初始化 Popup UI
 */

import { $, isRestrictedUrl } from './utils';
import { initNavigation } from './views/navigation';
import { initSettings } from './views/settings';
import { initCard } from './card';
import { createEqCurveDrawer } from './visualizer';
import { createMessenger } from '@nexus/kernel';
import { initSidePanel } from './side-panel';
import { bindRemoteUI } from '../remote';
import { enableSmoothScroll } from '../shared/smooth-scroll';

/**
 * Popup 初始化主函数
 */
async function main(): Promise<void> {
  // 启用 Mac 风格丝滑滚动
  enableSmoothScroll();

  const messenger = createMessenger('popup');

  // 获取当前活动标签页
  let activeTab: chrome.tabs.Tab | null = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
  } catch {
    // 静默处理
  }

  // 初始化视图导航
  initNavigation();

  // 初始化侧边面板
  initSidePanel();

  // 初始化设置页 (需要先获取 dict 用于 i18n)
  const { gSettings, registryEntries, dict } = await initSettings();

  // 初始化遥控功能 (传入当前标签页 ID 和 i18n 字典)
  if (activeTab?.id) {
    bindRemoteUI(activeTab.id, dict);
  }

  // 获取全局设置的函数 (供卡片使用)
  let currentSettings = gSettings;
  const getGlobalSettings = () => currentSettings;

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.globalSettings?.newValue) {
      currentSettings = changes.globalSettings.newValue;
    }
  });

  // 获取 DOM 元素
  const mainStage = $<HTMLElement>('main-stage');
  const bgStack = $<HTMLElement>('bg-stack');
  const bgHeader = $<HTMLElement>('bg-header');
  const bgBadge = $<HTMLElement>('bg-badge');
  const template = $<HTMLTemplateElement>('tmpl-card');
  const emptyState = $<HTMLElement>('empty-state');

  if (!mainStage || !bgStack || !template || !emptyState) {
    console.error('[SPECTRA Popup] 缺少必要的 DOM 元素');
    return;
  }

  // 尝试连接当前标签页
  if (activeTab && !isRestrictedUrl(activeTab.url)) {
    try {
      const port = chrome.tabs.connect(activeTab.id!, { name: 'popup-connection' });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 静默处理
    }

    // 初始化当前标签页卡片 (包含可视化循环)
    const mainCardSuccess = await initCard({
      container: mainStage,
      template,
      tab: activeTab,
      dict,
      registryEntries,
      getGlobalSettings,
      createEqCurveDrawer,
    });

    if (mainCardSuccess) {
      emptyState.classList.add('hidden');
    }
  }

  // ============================================
  // 查询后台标签页 (使用新的 TAB_GET_VISIBLE_TABS)
  // ============================================
  let hasBgAudio = false;

  try {
    // 先尝试使用新 API 获取可见标签页列表
    const result = await messenger.send('TAB_GET_VISIBLE_TABS');
    const visibleTabIds = result?.tabs ?? [];

    // 获取所有标签页信息
    const allTabs = await chrome.tabs.query({});
    const tabMap = new Map(allTabs.map(t => [t.id, t]));

    for (const tabId of visibleTabIds) {
      // 跳过当前标签页
      if (activeTab && tabId === activeTab.id) continue;

      const tab = tabMap.get(tabId);
      if (!tab || isRestrictedUrl(tab.url)) continue;

      const success = await initCard({
        container: bgStack,
        template,
        tab,
        dict,
        registryEntries,
        getGlobalSettings,
        createEqCurveDrawer,
        isBackground: true,
      });

      if (success) {
        bgHeader?.classList.remove('hidden');
        hasBgAudio = true;
      }
    }
  } catch {
    // 新 API 不可用，回退到原有逻辑
    console.debug('[SPECTRA Popup] TAB_GET_VISIBLE_TABS not available, falling back.');
    const allTabs = await chrome.tabs.query({});

    for (const tab of allTabs) {
      if (activeTab && tab.id === activeTab.id) continue;
      if (isRestrictedUrl(tab.url)) continue;

      const success = await initCard({
        container: bgStack,
        template,
        tab,
        dict,
        registryEntries,
        getGlobalSettings,
        createEqCurveDrawer,
        isBackground: true,
      });

      if (success) {
        bgHeader?.classList.remove('hidden');
        hasBgAudio = true;
      }
    }
  }

  // 更新后台标签计数
  if (bgBadge) {
    bgBadge.innerText = String(bgStack.children.length);
  }

  // 最终决定是否显示空状态
  const hasMainCard = mainStage.children.length > 0;
  const hasAnyCard = hasMainCard || hasBgAudio;

  if (!hasAnyCard) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }

  // 卡片创建完成后应用 i18n (模板克隆后的元素)
  const { updateCardsI18n } = await import('./views/i18n-apply');
  updateCardsI18n(dict, gSettings.visualizerEnabled);
}

// 等待 DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', main);

