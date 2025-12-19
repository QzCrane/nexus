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

/**
 * Popup 初始化主函数
 */
async function main(): Promise<void> {
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

  // 初始化设置页
  const { gSettings, userRegistry, dict } = await initSettings();

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
      userRegistry,
      getGlobalSettings,
      createEqCurveDrawer,
    });

    if (mainCardSuccess) {
      emptyState.classList.add('hidden');
    }
  }

  // 查询所有后台标签页
  const allTabs = await chrome.tabs.query({});
  let hasBgAudio = false;

  for (const tab of allTabs) {
    // 跳过当前标签页
    if (activeTab && tab.id === activeTab.id) continue;
    // 跳过受限页面
    if (isRestrictedUrl(tab.url)) continue;

    const success = await initCard({
      container: bgStack,
      template,
      tab,
      dict,
      userRegistry,
      getGlobalSettings,
      createEqCurveDrawer,
    });

    if (success) {
      bgHeader?.classList.remove('hidden');
      hasBgAudio = true;
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
}

// 等待 DOM 加载完成后执行
document.addEventListener('DOMContentLoaded', main);

