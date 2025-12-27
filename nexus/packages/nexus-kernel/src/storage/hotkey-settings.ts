/**
 * NEXUS Kernel - 快捷键设置存储
 */

import type { HotkeySettings } from '@nexus/contracts';
import { DEFAULT_HOTKEY_SETTINGS, DEFAULT_SLOTS } from '@nexus/contracts';

const KEY = 'hotkeySettings';

/** 获取快捷键设置 */
export async function getHotkeySettings(): Promise<HotkeySettings> {
	const result = await chrome.storage.local.get(KEY);
	if (!result[KEY]) {
		// 首次使用，返回默认配置
		return { ...DEFAULT_HOTKEY_SETTINGS };
	}
	return { ...DEFAULT_HOTKEY_SETTINGS, ...result[KEY] };
}

/** 保存快捷键设置 */
export async function setHotkeySettings(settings: Partial<HotkeySettings>): Promise<void> {
	const current = await getHotkeySettings();
	await chrome.storage.local.set({ [KEY]: { ...current, ...settings } });
}

/** 重置为默认配置 */
export async function resetHotkeySettings(): Promise<void> {
	await chrome.storage.local.set({
		[KEY]: {
			slots: { ...DEFAULT_SLOTS },
			sites: {},
		}
	});
}
