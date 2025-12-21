/**
 * SPECTRA Background - 设置处理器
 */

import { router, storage } from '../state';
import { Actions } from '@nexus/contracts';

/** 注册设置相关的消息处理器 */
export function registerSettingsHandlers(): void {
	router.on('SETTINGS_GET', async () => {
		return storage.getGlobalSettings();
	});

	router.on('SETTINGS_UPDATE', async (req) => {
		await storage.setGlobalSettings(req.settings);

		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, {
					action: Actions.GLOBAL_SETTINGS_UPDATE,
					settings: req.settings
				}).catch(() => { });
			}
		}

		return { success: true };
	});
}

