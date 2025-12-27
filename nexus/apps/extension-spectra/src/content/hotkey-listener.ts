/**
 * SPECTRA Content Script - 快捷键监听器
 *
 * 网站独立配置，默认关闭
 * 用户需在 Options 页为特定网站启用
 */

import type { HotkeySettings, HotkeyBinding, KeyCombo, SiteHotkeyConfig } from '@nexus/contracts';
import { DEFAULT_HOTKEY_SETTINGS } from '@nexus/contracts';
import { createLogger } from '../shared/logger';
import { executeHotkeyAction, setCachedConfig } from './hotkey-actions';
import { showToast } from './toast';

const log = createLogger('Hotkeys');

// 当前配置
let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };

/** 初始化快捷键监听器 */
export async function initHotkeyListener(): Promise<() => void> {
	await loadSettings();
	chrome.storage.onChanged.addListener(handleStorageChange);
	document.addEventListener('keydown', handleKeydown, true);
	log.info('Hotkey listener initialized');
	return () => {
		document.removeEventListener('keydown', handleKeydown, true);
		chrome.storage.onChanged.removeListener(handleStorageChange);
	};
}

/** 存储变化处理 */
function handleStorageChange(changes: { [key: string]: chrome.storage.StorageChange }): void {
	if (changes.hotkeySettings?.newValue) {
		settings = changes.hotkeySettings.newValue;
		log.debug('Settings updated');
	}
}

/** 加载配置 */
async function loadSettings(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('hotkeySettings');
		if (result.hotkeySettings) settings = result.hotkeySettings;
	} catch { /* context invalid */ }
}

/** 获取当前网站配置 */
function getSiteConfig(): SiteHotkeyConfig | null {
	const domain = location.hostname;
	const site = settings.sites[domain];
	// 网站配置不存在或未启用 → 不处理
	if (!site || !site.enabled) return null;
	return site;
}

/** 处理键盘事件 */
function handleKeydown(e: KeyboardEvent): void {
	// 获取网站配置 (默认关闭)
	const site = getSiteConfig();
	if (!site) return;

	// 忽略输入框
	if (isInputElement(e.target)) return;

	// 查找匹配绑定
	const binding = findMatch(e, site.bindings);
	if (!binding) return;

	e.preventDefault();
	e.stopPropagation();
	executeWithOSD(binding);
}

/** 执行动作并显示 OSD */
function executeWithOSD(binding: HotkeyBinding): void {
	const silent = ['none', 'open_popup', 'open_options', 'open_url', 'run_js'];
	if (!silent.includes(binding.action)) {
		showToast(formatLabel(binding.action, binding.params));
	}
	executeHotkeyAction(binding.action, binding.params);
}

/** 格式化动作标签 */
function formatLabel(action: string, params?: { step?: number }): string {
	const map: Record<string, string> = {
		play_pause: '⏯️', speed_up: `⏩ +${params?.step ?? 0.1}x`, speed_down: `⏪ -${params?.step ?? 0.1}x`,
		speed_reset: '🔄 1x', volume_up: `🔊 +${params?.step ?? 10}`, volume_down: `🔉 -${params?.step ?? 10}`,
		volume_mute: '🔇', fullscreen_toggle: '📺', pip_toggle: '🖼️',
	};
	return map[action] ?? action.replace(/_/g, ' ');
}

/** 判断输入框 */
function isInputElement(t: EventTarget | null): boolean {
	if (!t || !(t instanceof HTMLElement)) return false;
	const tag = t.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}

/** 查找匹配绑定 */
function findMatch(e: KeyboardEvent, bindings: HotkeyBinding[]): HotkeyBinding | null {
	const combo: KeyCombo = {
		code: e.code,
		modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
	};
	for (const b of bindings) {
		if (!b.enabled) continue;
		if (matchCombo(b.key, combo)) return b;
	}
	return null;
}

/** 匹配按键组合 */
function matchCombo(a: KeyCombo, b: KeyCombo): boolean {
	return a.code === b.code
		&& a.modifiers.ctrl === b.modifiers.ctrl
		&& a.modifiers.alt === b.modifiers.alt
		&& a.modifiers.shift === b.modifiers.shift
		&& a.modifiers.meta === b.modifiers.meta;
}

export { setCachedConfig };
