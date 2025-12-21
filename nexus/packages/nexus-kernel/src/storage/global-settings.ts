/**
 * NEXUS Kernel - 全局设置存储
 */

import { GlobalSettings, DEFAULT_GLOBAL_SETTINGS } from '../messages/protocol.js';

const KEY = 'globalSettings';

/** 获取全局设置 */
export async function getGlobalSettings(): Promise<GlobalSettings> {
	const result = await chrome.storage.local.get(KEY);
	return result[KEY] ? { ...DEFAULT_GLOBAL_SETTINGS, ...result[KEY] } : { ...DEFAULT_GLOBAL_SETTINGS };
}

/** 保存全局设置 */
export async function setGlobalSettings(settings: Partial<GlobalSettings>): Promise<void> {
	const current = await getGlobalSettings();
	await chrome.storage.local.set({ [KEY]: { ...current, ...settings } });
}
