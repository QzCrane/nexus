/**
 * NEXUS 消息协议 - 消息定义
 */

import type { AudioConfig, AudioState, AudioMode } from '../audio.contracts.js';
import type { GlobalSettings } from '../settings.contracts.js';

/** NEXUS 消息协议注册表 */
export interface NexusMessages {
	// ========== 音频控制 ==========
	'AUDIO_GET_STATUS': {
		req: void;
		res: { config: AudioConfig; hasAudio: boolean; isPlaying: boolean; mode: AudioMode; userInteracted: boolean };
	};
	'AUDIO_SET_CONFIG': {
		req: { config: Partial<AudioConfig> };
		res: { success: boolean; state?: { config: AudioConfig; hasAudio: boolean; isPlaying: boolean; mode: AudioMode; userInteracted: boolean } };
	};
	'AUDIO_GET_VISUALIZER': { req: void; res: { buffer: number[] | null } };

	// ========== Capture 模式 ==========
	'CAPTURE_TOGGLE': { req: { enabled: boolean; config?: AudioConfig; tabId?: number }; res: { status: 'processing' | 'error'; error?: string } };
	'CAPTURE_GET_STATE': { req: { tabId?: number }; res: boolean };
	'CAPTURE_UPDATE_CONFIG': { req: { tabId: number; config: AudioConfig }; res: void };
	'CAPTURE_STATE_CHANGE': { req: { tabId?: number; enabled: boolean }; res: void };

	// ========== 全局设置 ==========
	'SETTINGS_UPDATE': { req: { settings: Partial<GlobalSettings> }; res: { success: boolean } };
	'SETTINGS_GET': { req: void; res: GlobalSettings };

	// ========== 角标 ==========
	'BADGE_UPDATE': { req: { tabId?: number; volume: number; muted: boolean; isCapture: boolean }; res: void };
	'BADGE_CLEAR': { req: { tabId?: number }; res: void };

	// ========== UI 同步 ==========
	'UI_SYNC': { req: { config: AudioConfig; mode?: AudioMode; isCaptureActive?: boolean }; res: void };

	// ========== 快捷键 ==========
	'SHORTCUT_TRIGGER': { req: { command: 'volume_up' | 'volume_down' | 'toggle_mute'; config?: AudioConfig }; res: void };

	// ========== 注册表 ==========
	'REGISTRY_ADD_DOMAIN': { req: { domain: string }; res: { success: boolean; reason?: string } };
	'REGISTRY_REMOVE_DOMAIN': { req: { domain: string }; res: { success: boolean } };

	// ========== Tab 状态 ==========
	'TAB_REPORT_MEDIA': { req: { hasMediaElement: boolean }; res: void };
	'TAB_GET_VISIBLE_TABS': { req: void; res: { tabs: number[] } };
}

/** Action 名称联合类型 */
export type NexusAction = keyof NexusMessages;
/** Request 类型 */
export type NexusRequest<A extends NexusAction> = NexusMessages[A]['req'];
/** Response 类型 */
export type NexusResponse<A extends NexusAction> = NexusMessages[A]['res'];
