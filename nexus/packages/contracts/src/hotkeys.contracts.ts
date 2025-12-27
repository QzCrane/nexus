/**
 * 快捷键契约 (Hotkeys Contracts)
 * 
 * 定义快捷键类型、动作、绑定规则。
 * 
 * @packageDocumentation
 */

// ============================================
// 快捷键动作类型
// ============================================

/** 所有可绑定的动作 */
export const HOTKEY_ACTIONS = [
	// 无操作
	'none',
	// 播放控制
	'play_pause',
	'seek_forward_5s',
	'seek_forward_10s',
	'seek_forward_30s',
	'seek_backward_5s',
	'seek_backward_10s',
	'seek_backward_30s',
	'seek_frame_forward',
	'seek_frame_backward',
	// 速度控制
	'speed_up',
	'speed_down',
	'speed_reset',
	'speed_set',           // 需要参数
	// 音量控制
	'volume_up',
	'volume_down',
	'volume_mute',
	'volume_set',          // 需要参数
	// 音频增强
	'audio_reset',
	'gain_up',
	'gain_down',
	'pitch_up',
	'pitch_down',
	'pitch_reset',
	'delay_up',
	'delay_down',
	'delay_reset',
	'pan_left',
	'pan_right',
	'pan_reset',
	'mono_toggle',
	'capture_toggle',
	// 视频控制
	'fullscreen_toggle',
	'pip_toggle',
	'rotate_cw',
	'rotate_ccw',
	'mirror_toggle',
	'screenshot',
	'dim_background',
	// 标记与循环
	'marker_add',
	'marker_jump_prev',
	'marker_jump_next',
	'ab_set_a',
	'ab_set_b',
	'ab_clear',
	'ab_skip',
	'loop_toggle',
	// FX 滤镜
	'fx_toggle',
	'fx_reset',
	// 标签页
	'tab_pin',
	'tab_mute',
	// 杂项
	'show_info',
	'open_popup',
	'open_options',
	'run_js',              // 需要参数
	'open_url',            // 需要参数
] as const;

export type HotkeyAction = typeof HOTKEY_ACTIONS[number];

// ============================================
// 按键修饰符
// ============================================

/** 修饰键 */
export interface KeyModifiers {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;       // Windows/Command 键
}

/** 按键组合 */
export interface KeyCombo {
	/** 主键 (KeyboardEvent.code) */
	code: string;
	/** 修饰键 */
	modifiers: KeyModifiers;
}

// ============================================
// 快捷键绑定
// ============================================

/** 单个快捷键绑定 */
export interface HotkeyBinding {
	/** 唯一标识 */
	id: string;
	/** 是否启用 */
	enabled: boolean;
	/** 按键组合 */
	key: KeyCombo;
	/** 触发的动作 */
	action: HotkeyAction;
	/** 动作参数 (speed_set 的速度值、run_js 的脚本等) */
	params?: HotkeyParams;
	/** 触发条件 (可选) */
	conditions?: HotkeyConditions;
}

/** 动作参数 */
export interface HotkeyParams {
	/** 速度值 (0.1-16) */
	speed?: number;
	/** 音量值 (0-800) */
	volume?: number;
	/** 步进值 (用于增减操作) */
	step?: number;
	/** JavaScript 代码 */
	script?: string;
	/** URL */
	url?: string;
}

/** 触发条件 */
export interface HotkeyConditions {
	/** 仅在这些域名生效 (空=全局) */
	domains?: string[];
	/** 仅在有媒体时生效 */
	requireMedia?: boolean;
}

// ============================================
// 快捷键配置 (Chrome 全局 + 网站独立)
// ============================================

/** Chrome Command Slot 映射 */
export type SlotMapping = Record<string, HotkeyAction>;

/** 网站独立配置 */
export interface SiteHotkeyConfig {
	/** 是否启用网页内快捷键 (默认 false) */
	enabled: boolean;
	/** 网页内绑定列表 */
	bindings: HotkeyBinding[];
}

/** 快捷键全局配置 */
export interface HotkeySettings {
	/** Chrome Command Slot → Action 映射 */
	slots: SlotMapping;
	/** 网站配置 (域名 → 配置) */
	sites: Record<string, SiteHotkeyConfig>;
}

// ============================================
// 默认配置
// ============================================

/** 默认修饰键 */
export const DEFAULT_MODIFIERS: Readonly<KeyModifiers> = {
	ctrl: false, alt: false, shift: false, meta: false,
} as const;

/** 默认 Slot 映射 (对应 manifest.json 的 commands) */
export const DEFAULT_SLOTS: SlotMapping = {
	volume_up: 'volume_up',
	volume_down: 'volume_down',
	toggle_mute: 'volume_mute',
	speed_up: 'speed_up',
	// slot_01 ~ slot_16 未绑定
};

/** 默认快捷键设置 */
export const DEFAULT_HOTKEY_SETTINGS: Readonly<HotkeySettings> = {
	slots: DEFAULT_SLOTS,
	sites: {},  // 网站配置默认关闭
} as const;

// ============================================
// 预设 (从单独文件重导出)
// ============================================

export { PRESET_BINDINGS } from './hotkeys.presets.js';
