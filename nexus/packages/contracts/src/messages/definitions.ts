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
	'CAPTURE_UPDATE_CONFIG': { req: { tabId?: number; config: AudioConfig }; res: void };
	'CAPTURE_STATE_CHANGE': { req: { tabId?: number; enabled: boolean }; res: void };

	// ========== 全局设置 ==========
	'SETTINGS_UPDATE': { req: { settings: Partial<GlobalSettings> }; res: { success: boolean } };
	'SETTINGS_GET': { req: void; res: GlobalSettings };

	// ========== 角标 ==========
	'BADGE_UPDATE': { req: { tabId?: number; volume: number; muted: boolean; isCapture: boolean; userInteracted?: boolean }; res: void };
	'BADGE_CLEAR': { req: { tabId?: number }; res: void };

	// ========== UI 同步 ==========
	'UI_SYNC': { req: { config: AudioConfig; mode?: AudioMode; isCaptureActive?: boolean }; res: void };

	// ========== 快捷键 ==========
	'SHORTCUT_TRIGGER': { req: { command: 'volume_up' | 'volume_down' | 'toggle_mute'; config?: AudioConfig }; res: void };

	// ========== 注册表 ==========
	'REGISTRY_ADD_DOMAIN': { req: { domain: string }; res: { success: boolean; reason?: string } };
	'REGISTRY_REMOVE_DOMAIN': { req: { domain: string }; res: { success: boolean } };
	'REGISTRY_QUERY_DOMAIN': { req: { domain: string }; res: { entry: import('../registry.contracts.js').DomainEntry | null } };
	'REGISTRY_MARK_PROBED': { req: { domain: string; restricted: boolean }; res: { success: boolean; reason?: string } };

	// ========== 媒体控制 ==========
	'MEDIA_TOGGLE_PLAY': { req: void; res: { playing: boolean } };
	'MEDIA_TOGGLE_PIP': { req: void; res: { active: boolean } };
	'MEDIA_SET_SPEED': { req: { speed: number; preservePitch?: boolean }; res: { speed: number; preservePitch: boolean } };
	'MEDIA_GET_STATE': { req: void; res: { playing: boolean; speed: number; pipActive: boolean; preservePitch: boolean } };

	// ========== 视频变换 ==========
	'VIDEO_ROTATE': { req: void; res: { rotation: number } };
	'VIDEO_MIRROR': { req: void; res: { mirrored: boolean } };
	'VIDEO_SCREENSHOT': { req: void; res: { dataUrl: string | null } };
	'VIDEO_FULLSCREEN': { req: void; res: { active: boolean } };
	'VIDEO_CROP': { req: void; res: { cropped: boolean } };
	'VIDEO_SEEK': { req: { delta: number }; res: { currentTime: number } };

	// ========== 视觉滤镜 ==========
	'VIDEO_SET_FILTER': { req: { brightness?: number; contrast?: number; saturate?: number; grayscale?: boolean; invert?: boolean }; res: { applied: boolean } };
	'VIDEO_RESET_FILTER': { req: void; res: { reset: boolean } };
	'VIDEO_DIM_BACKGROUND': { req: { enabled?: boolean; opacity?: number }; res: { active: boolean; opacity: number } };

	// ========== AB 循环 ==========
	'VIDEO_AB_SET_A': { req: void; res: { pointA: number | null } };
	'VIDEO_AB_SET_B': { req: void; res: { pointB: number | null; looping: boolean } };
	'VIDEO_AB_CLEAR': { req: void; res: { cleared: boolean } };
	'VIDEO_AB_GET_STATE': { req: void; res: { pointA: number | null; pointB: number | null; looping: boolean } };

	// ========== 时间标记 ==========
	'VIDEO_MARKER_ADD': { req: { label?: string }; res: { id: string; time: number; label: string } };
	'VIDEO_MARKER_REMOVE': { req: { id: string }; res: { removed: boolean } };
	'VIDEO_MARKER_JUMP': { req: { id: string }; res: { jumped: boolean; time: number } };
	'VIDEO_MARKER_LIST': { req: void; res: { markers: Array<{ id: string; time: number; label: string }> } };

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
