/**
 * 快捷键预设配置
 * 
 * 默认全局快捷键，使用通用且不易冲突的按键
 * 用户可在 Options 页修改或针对特定网站禁用
 */

import type { HotkeyBinding, KeyModifiers } from './hotkeys.contracts';

/** 默认修饰键 (本地副本，避免循环依赖) */
const M: Readonly<KeyModifiers> = { ctrl: false, alt: false, shift: false, meta: false };

/** 预设全局快捷键 (通用按键，默认生效) */
export const PRESET_BINDINGS: readonly HotkeyBinding[] = [
	// ========== 速度控制 (S/A/D - 无修饰键) ==========
	{ id: 'speed-up', enabled: true, key: { code: 'KeyS', modifiers: M }, action: 'speed_up', params: { step: 0.1 } },
	{ id: 'speed-down', enabled: true, key: { code: 'KeyA', modifiers: M }, action: 'speed_down', params: { step: 0.1 } },
	{ id: 'speed-reset', enabled: true, key: { code: 'KeyD', modifiers: M }, action: 'speed_reset' },

	// ========== 跳转 (方向键 - 通用) ==========
	{ id: 'seek-back-10', enabled: true, key: { code: 'ArrowLeft', modifiers: M }, action: 'seek_backward_10s' },
	{ id: 'seek-fwd-10', enabled: true, key: { code: 'ArrowRight', modifiers: M }, action: 'seek_forward_10s' },

	// ========== 音量 (Alt + 方向键) ==========
	{ id: 'vol-up', enabled: true, key: { code: 'ArrowUp', modifiers: { ...M, alt: true } }, action: 'volume_up', params: { step: 10 } },
	{ id: 'vol-down', enabled: true, key: { code: 'ArrowDown', modifiers: { ...M, alt: true } }, action: 'volume_down', params: { step: 10 } },
	{ id: 'vol-mute', enabled: true, key: { code: 'KeyM', modifiers: { ...M, alt: true } }, action: 'volume_mute' },

	// ========== 视频控制 (Alt + 字母) ==========
	{ id: 'pip-toggle', enabled: true, key: { code: 'KeyP', modifiers: { ...M, alt: true } }, action: 'pip_toggle' },
	{ id: 'fullscreen', enabled: true, key: { code: 'KeyF', modifiers: { ...M, alt: true } }, action: 'fullscreen_toggle' },
] as const;
