/**
 * SPECTRA Background - 快捷键处理
 * 
 * 处理用户快捷键操作（音量增减、静音切换）
 */

import type { AudioConfig } from '@nexus/kernel';
import { Actions, DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { storage, captureStates, BADGE_COLORS } from './state';
import { swLog } from '../shared/logger';

// 🔴 域名配置内存缓存 (解决快速连击竞态条件)
const configCache = new Map<string, AudioConfig>();

/** 读取配置 (优先缓存) */
async function getConfigWithCache(domain: string): Promise<AudioConfig> {
	const cached = configCache.get(domain);
	if (cached) return cached;
	const stored = await storage.getAudioConfig(domain);
	configCache.set(domain, stored);
	return stored;
}

/** 写入配置 (同步更新缓存，异步持久化) */
function setConfigWithCache(domain: string, config: AudioConfig): void {
	configCache.set(domain, config);
	// 异步持久化，不阻塞
	storage.setAudioConfig(domain, config).catch(() => { });
}

/**
 * 设置快捷键监听器
 */
export function setupShortcutListeners(): void {
	chrome.commands.onCommand.addListener(async (command) => {
		swLog.debug(`Shortcut command: ${command}`);

		// 获取当前活动标签页
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id || !tab.url) return;

		let domain = '';
		try {
			domain = new URL(tab.url).hostname;
		} catch {
			return;
		}

		const oldConfig = await getConfigWithCache(domain);
		let newConfig: Partial<AudioConfig> = {};

		switch (command) {
			case 'volume_up':
				newConfig = { volume: Math.min(800, oldConfig.volume + 10) };
				break;
			case 'volume_down':
				newConfig = { volume: Math.max(0, oldConfig.volume - 10) };
				break;
			case 'toggle_mute':
				newConfig = { muted: !oldConfig.muted };
				break;
		}

		// 合并新配置
		const mergedConfig = { ...oldConfig, ...newConfig };

		// 🔴 同步更新缓存 + 异步持久化 (解决竞态)
		setConfigWithCache(domain, mergedConfig);

		// 通知 Content Script 更新音频图
		try {
			await chrome.tabs.sendMessage(tab.id, {
				action: Actions.SHORTCUT_TRIGGER,
				payload: { command, config: mergedConfig }
			});
		} catch {
			// Content Script 可能未加载
		}

		// 关键：不再由 Background 广播 UI_SYNC。
		// Content Script 收到 SHORTCUT_TRIGGER 后会执行策略并统一广播准确的状态（包括 isCaptureActive）。
	});
}

