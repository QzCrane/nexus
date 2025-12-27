/**
 * SPECTRA Background - 快捷键处理
 * 
 * 处理 Chrome 全局快捷键 (manifest commands)
 * - 预设: volume_up, volume_down, toggle_mute, speed_up
 * - 自定义 Slot: slot_01 ~ slot_16
 */

import type { AudioConfig, HotkeySettings, HotkeyAction } from '@nexus/contracts';
import { Actions, DEFAULT_AUDIO_CONFIG, DEFAULT_HOTKEY_SETTINGS } from '@nexus/contracts';
import { storage } from './state';
import { swLog } from '../shared/logger';

// 域名配置内存缓存 (解决快速连击竞态条件)
const configCache = new Map<string, AudioConfig>();
// Slot 映射缓存
let slotMapping: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEY_SETTINGS.slots };

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
	storage.setAudioConfig(domain, config).catch(() => { });
}

/** 加载 Slot 映射 */
async function loadSlotMapping(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('hotkeySettings');
		if (result.hotkeySettings?.slots) {
			slotMapping = result.hotkeySettings.slots;
		}
	} catch { /* ignore */ }
}

/** 设置快捷键监听器 */
export function setupShortcutListeners(): void {
	// 初始加载 Slot 映射
	loadSlotMapping();

	// 监听存储变化
	chrome.storage.onChanged.addListener((changes) => {
		if (changes.hotkeySettings?.newValue?.slots) {
			slotMapping = changes.hotkeySettings.newValue.slots;
		}
	});

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

		// 解析 action
		let action: HotkeyAction | undefined;
		if (command.startsWith('slot_')) {
			action = slotMapping[command];
			if (!action || action === 'none') return;
		} else {
			// 直接命令映射
			action = resolveDirectCommand(command);
		}

		if (!action) return;

		// 执行 action
		await executeAction(action, tab.id, domain);
	});
}

/** 直接命令 → action 映射 */
function resolveDirectCommand(command: string): HotkeyAction | undefined {
	const map: Record<string, HotkeyAction> = {
		volume_up: 'volume_up',
		volume_down: 'volume_down',
		toggle_mute: 'volume_mute',
		speed_up: 'speed_up',
	};
	return map[command];
}

/** 执行 action */
async function executeAction(action: HotkeyAction, tabId: number, domain: string): Promise<void> {
	const oldConfig = await getConfigWithCache(domain);
	let newConfig: Partial<AudioConfig> = {};

	switch (action) {
		case 'volume_up':
			newConfig = { volume: Math.min(800, oldConfig.volume + 10) };
			break;
		case 'volume_down':
			newConfig = { volume: Math.max(0, oldConfig.volume - 10) };
			break;
		case 'volume_mute':
			newConfig = { muted: !oldConfig.muted };
			break;
		case 'speed_up':
		case 'speed_down':
		case 'speed_reset':
		case 'play_pause':
		case 'pip_toggle':
		case 'fullscreen_toggle':
			// 这些 action 需要发送到 Content Script 执行
			try {
				await chrome.tabs.sendMessage(tabId, {
					action: Actions.SHORTCUT_TRIGGER,
					payload: { command: action }
				});
			} catch { /* Content Script 可能未加载 */ }
			return;
		default:
			return;
	}

	// 音量相关: 更新配置并通知
	const mergedConfig = { ...oldConfig, ...newConfig };
	setConfigWithCache(domain, mergedConfig);

	try {
		await chrome.tabs.sendMessage(tabId, {
			action: Actions.SHORTCUT_TRIGGER,
			payload: { command: action, config: mergedConfig }
		});
	} catch { /* Content Script 可能未加载 */ }
}
