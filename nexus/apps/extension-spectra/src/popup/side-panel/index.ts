/**
 * SPECTRA Popup - 侧边面板逻辑
 * 职责：点击 favicon 展开/收起左侧扩展面板，固定/取消固定
 */

import type { AudioConfig } from '@nexus/kernel';
import { bindSidePanelControls, syncSidePanelState } from './controls';
import { bindVideoControls, setVideoControlTabId } from './video-controls';
import { bindFooterActions } from './footer-actions';
import { getCardRegistration as getCardReg, updateCardConfig as updateReg } from './registry';

// 重导出 registry 函数
export { registerCard, getCardRegistration } from './registry';

/** 侧边面板状态 */
interface SidePanelState {
	isOpen: boolean;
	isPinned: boolean;
	currentTabId: number | null;
}

/** 侧边面板元素引用 */
interface SidePanelElements {
	panel: HTMLElement;
	icon: HTMLImageElement;
	title: HTMLElement;
	btnPin: HTMLElement;
	btnClose: HTMLElement;
}

const state: SidePanelState = {
	isOpen: false,
	isPinned: false,
	currentTabId: null,
};

let elements: SidePanelElements | null = null;

/**
 * 更新已注册卡片的配置 (带同步)
 */
export function updateCardConfig(tabId: number, config: AudioConfig): void {
	updateReg(tabId, config);
	// 如果当前打开的是这个 tab，同步侧边面板
	if (state.isOpen && state.currentTabId === tabId) {
		syncSidePanelState(config);
	}
}

/**
 * 初始化侧边面板
 */
export function initSidePanel(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	elements = {
		panel,
		icon: panel.querySelector('.side-panel-icon') as HTMLImageElement,
		title: panel.querySelector('.side-panel-title') as HTMLElement,
		btnPin: panel.querySelector('.btn-pin') as HTMLElement,
		btnClose: panel.querySelector('.btn-close-panel') as HTMLElement,
	};

	// 固定按钮点击
	elements.btnPin?.addEventListener('click', () => {
		state.isPinned = !state.isPinned;
		elements?.btnPin.classList.toggle('active', state.isPinned);
		chrome.storage.local.set({ sidePanelPinned: state.isPinned });
	});

	// 关闭按钮点击
	elements.btnClose?.addEventListener('click', () => closeSidePanel());

	// 点击面板外区域关闭（非固定时）
	document.addEventListener('click', (e) => {
		if (!state.isOpen || state.isPinned) return;
		const target = e.target as HTMLElement;
		if (!elements?.panel.contains(target) && !target.closest('.meta-icon')) {
			closeSidePanel();
		}
	});

	// 从存储恢复固定状态
	chrome.storage.local.get(['sidePanelPinned'], (r) => {
		state.isPinned = r.sidePanelPinned ?? false;
		elements?.btnPin.classList.toggle('active', state.isPinned);
	});

	// 绑定 Footer 按钮
	bindFooterActions();
}

/**
 * 绑定卡片图标点击事件
 */
export function bindCardIconClick(
	iconEl: HTMLElement,
	tabId: number,
	tabTitle: string,
	faviconUrl: string,
	i18nTitle?: string
): void {
	iconEl.style.cursor = 'pointer';
	iconEl.title = i18nTitle || 'Click for advanced settings';

	iconEl.addEventListener('click', (e) => {
		e.stopPropagation();
		if (state.isOpen && state.currentTabId === tabId) {
			closeSidePanel();
		} else {
			openSidePanel(tabId, tabTitle, faviconUrl);
		}
	});
}

/** 打开侧边面板 */
function openSidePanel(tabId: number, title: string, faviconUrl: string): void {
	if (!elements) return;
	state.isOpen = true;
	state.currentTabId = tabId;

	// 更新面板头部信息
	elements.icon.src = faviconUrl || '';
	elements.title.textContent = title || 'Settings';

	// 添加打开类
	document.documentElement.classList.add('side-panel-open');
	// 使用 RAF 确保窗口调整尺寸后再显示面板，避免闪烁
	requestAnimationFrame(() => {
		elements?.panel.classList.add('open');
	});

	// 绑定控件事件
	const reg = getCardReg(tabId);
	if (reg) {
		bindSidePanelControls(reg.getConfig(), reg.update, tabId);
	}

	// 绑定视频控制按钮
	setVideoControlTabId(tabId);
	bindVideoControls();
}

/** 关闭侧边面板 */
function closeSidePanel(): void {
	if (!elements) return;
	state.isOpen = false;
	state.currentTabId = null;

	// 先触发淡出动画
	elements.panel.classList.remove('open');

	// 等待动画结束后调整窗口尺寸 (200ms 匹配 CSS)
	setTimeout(() => {
		document.documentElement.classList.remove('side-panel-open');
	}, 200);
}

/** 获取当前打开的 tabId */
export function getCurrentPanelTabId(): number | null {
	return state.currentTabId;
}

/** 检查面板是否打开 */
export function isSidePanelOpen(): boolean {
	return state.isOpen;
}
