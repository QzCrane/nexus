/**
 * SPECTRA Popup - 主题管理工具
 * 
 * 处理浅色/深色/系统自动主题切换
 */

import type { ThemeMode } from '@nexus/contracts';

// ============================================
// 配置常量
// ============================================

/** 主题存储键 */
const THEME_ATTRIBUTE = 'data-theme';

/** 系统深色模式媒体查询 */
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

// ============================================
// 主题应用函数
// ============================================

/** 系统媒体查询对象 */
let systemMediaQuery: MediaQueryList | null = null;

/** 系统主题变化监听器 */
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

/**
 * 应用主题到 DOM
 * @param mode 主题模式 (light/dark/system)
 */
export function applyTheme(mode: ThemeMode): void {
	// 清理旧的系统监听器
	removeSystemThemeListener();

	if (mode === 'system') {
		// 系统模式: 根据系统偏好设置，并监听变化
		systemMediaQuery = window.matchMedia(DARK_MODE_QUERY);
		const currentTheme = systemMediaQuery.matches ? 'dark' : 'light';
		document.documentElement.setAttribute(THEME_ATTRIBUTE, currentTheme);

		// 监听系统主题变化
		systemThemeListener = (e: MediaQueryListEvent) => {
			document.documentElement.setAttribute(THEME_ATTRIBUTE, e.matches ? 'dark' : 'light');
		};
		systemMediaQuery.addEventListener('change', systemThemeListener);
	} else {
		// 固定模式: 直接设置
		document.documentElement.setAttribute(THEME_ATTRIBUTE, mode);
	}
}

/**
 * 移除系统主题变化监听器
 */
function removeSystemThemeListener(): void {
	if (systemMediaQuery && systemThemeListener) {
		systemMediaQuery.removeEventListener('change', systemThemeListener);
		systemThemeListener = null;
		systemMediaQuery = null;
	}
}

/**
 * 获取当前生效的主题 (解析 system 模式)
 * @returns 当前实际主题 ('light' | 'dark')
 */
export function getEffectiveTheme(): 'light' | 'dark' {
	const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
	return attr === 'dark' ? 'dark' : 'light';
}

/**
 * 主题图标映射
 */
export const THEME_ICONS: Record<ThemeMode, string> = {
	light: '☀️',
	dark: '🌙',
	system: '🖥️'
};

/**
 * 获取下一个主题模式 (循环切换)
 */
export function getNextThemeMode(current: ThemeMode): ThemeMode {
	const modes: ThemeMode[] = ['light', 'dark', 'system'];
	const idx = modes.indexOf(current);
	return modes[(idx + 1) % modes.length] ?? 'system';
}
