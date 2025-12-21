/**
 * SPECTRA Background - 设置处理器
 * 
 * 处理全局设置相关的消息
 */

import { router, storage } from '../state';

/**
 * 注册设置相关的消息处理器
 */
export function registerSettingsHandlers(): void {
	// 获取全局设置
	router.on('SETTINGS_GET', async () => {
		return storage.getGlobalSettings();
	});

	// 更新全局设置
	router.on('SETTINGS_UPDATE', async (req) => {
		await storage.setGlobalSettings(req.settings);

		// 广播通知所有标签页
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, {
					action: 'GLOBAL_SETTINGS_UPDATE',
					settings: req.settings
				}).catch(() => { });
			}
		}

		return { success: true };
	});
}
