/**
 * NEXUS Kernel - 音频配置存储
 */

import { AudioConfig, DEFAULT_AUDIO_CONFIG } from '../messages/protocol.js';

const KEY = 'siteSettings';
type SiteSettingsMap = Record<string, AudioConfig>;

/** 获取音频配置 */
export async function getAudioConfig(domain: string): Promise<AudioConfig> {
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	return settings[domain] ? { ...DEFAULT_AUDIO_CONFIG, ...settings[domain] } : { ...DEFAULT_AUDIO_CONFIG };
}

/** 保存音频配置 */
export async function setAudioConfig(domain: string, config: Partial<AudioConfig>): Promise<void> {
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	settings[domain] = { ...DEFAULT_AUDIO_CONFIG, ...settings[domain], ...config };
	await chrome.storage.local.set({ [KEY]: settings });
}

/** 删除音频配置 */
export async function removeAudioConfig(domain: string): Promise<void> {
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	delete settings[domain];
	await chrome.storage.local.set({ [KEY]: settings });
}
