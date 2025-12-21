/**
 * SPECTRA Background - 辅助函数
 * 
 * Tab 状态检查和 Offscreen Document 管理
 */

import { swLog } from '../shared/logger';

/**
 * 检查标签页是否存在
 * @param tabId - 标签页 ID
 * @returns 是否存在
 */
export async function isTabExists(tabId: number): Promise<boolean> {
	try {
		await chrome.tabs.get(tabId);
		return true;
	} catch {
		return false;
	}
}

/**
 * 确保 Offscreen Document 存在
 * Offscreen 用于处理 Tab Capture 的音频流
 */
export async function ensureOffscreen(): Promise<void> {
	const has = await chrome.offscreen.hasDocument();
	if (!has) {
		swLog.debug('Creating offscreen document...');
		await chrome.offscreen.createDocument({
			url: 'offscreen.html',
			reasons: ['USER_MEDIA'] as chrome.offscreen.Reason[],
			justification: 'Audio processing and visualizer'
		});
		swLog.debug('Offscreen document created');
	}
}
