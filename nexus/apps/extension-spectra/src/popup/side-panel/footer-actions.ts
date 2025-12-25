/**
 * SPECTRA Popup - 侧边面板 Footer 操作
 * 职责：重置/保存 效果预设 (EQ/Pan/Delay 等高级配置)
 * 注意：与主UI卡片的音量预设独立
 */

import { DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import { getCurrentPanelTabId, getCardRegistration } from './index';
import { syncSidePanelState } from './controls';

/** 效果预设 storage key 前缀 */
const FX_PRESET_PREFIX = 'preset_fx_';

/**
 * 绑定侧边面板 Footer 按钮事件
 */
export function bindFooterActions(): void {
	const btnReset = document.querySelector('.sp-btn-reset') as HTMLButtonElement | null;
	const btnSave = document.querySelector('.sp-btn-save') as HTMLButtonElement | null;

	btnReset?.addEventListener('click', handleReset);
	btnSave?.addEventListener('click', handleSave);
}



/** 重置：恢复效果到默认值 (保留音量) */
function handleReset(): void {
	const tabId = getCurrentPanelTabId();
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	// 重置效果参数
	const resetValues = {
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		pan: DEFAULT_AUDIO_CONFIG.pan,
		delay: DEFAULT_AUDIO_CONFIG.delay,
	};

	// 发送到 Content Script / Offscreen 应用配置
	reg.update(resetValues);

	// 同步侧边面板 UI (关键：确保滑块位置与配置同步)
	const newConfig = { ...reg.getConfig(), ...resetValues };
	syncSidePanelState(newConfig);
}

/** 保存：将效果配置存储到域名预设 */
async function handleSave(): Promise<void> {
	const tabId = getCurrentPanelTabId();
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	const domain = await getDomainForTab(tabId);
	if (!domain) return;

	const config = reg.getConfig();
	// 只保存效果相关配置
	const fxPreset = {
		eqValues: config.eqValues,
		pan: config.pan,
		delay: config.delay,
	};

	const key = `${FX_PRESET_PREFIX}${domain}`;
	await chrome.storage.local.set({ [key]: fxPreset });
}

/**
 * 加载效果预设 (供 openSidePanel 调用)
 */
export async function loadFxPreset(domain: string): Promise<{
	eqValues?: number[];
	pan?: number;
	delay?: number;
} | null> {
	const key = `${FX_PRESET_PREFIX}${domain}`;
	const result = await chrome.storage.local.get([key]);
	return result[key] || null;
}

/** 获取标签页域名 */
async function getDomainForTab(tabId: number): Promise<string | null> {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!tab?.url) return null;
		return new URL(tab.url).hostname.replace('www.', '');
	} catch {
		return null;
	}
}
