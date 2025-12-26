/**
 * SPECTRA Remote - 命令执行器
 */

import { Actions } from '@nexus/contracts';

/** 遥控命令类型 */
export type RemoteCommand =
	| 'volume_up'        // 音量 +10
	| 'volume_down'      // 音量 -10
	| 'volume_max'       // 音量最大
	| 'volume_100'       // 音量 100%
	| 'mute'             // 静音切换
	| 'play_pause'       // 播放/暂停
	| 'seek_forward'     // 前进 10s
	| 'seek_backward'    // 后退 10s
	| 'seek_forward_30'  // 前进 30s
	| 'seek_backward_30' // 后退 30s
	| 'speed_up'         // 加速 0.25x
	| 'speed_down'       // 减速 0.25x
	| 'speed_reset'      // 重置速度
	| 'fullscreen'       // 全屏切换
	| 'pip';             // 画中画

/**
 * 执行遥控命令
 * 注意：消息格式必须与 content script 处理器一致 (payload 包装)
 */
export function executeCommand(cmd: RemoteCommand, tabId: number): void {
	switch (cmd) {
		// ===== 音量控制 =====
		case 'volume_up':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volumeDelta: 10 } } });
			break;
		case 'volume_down':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volumeDelta: -10 } } });
			break;
		case 'volume_max':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volume: 800 } } });
			break;
		case 'volume_100':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volume: 100 } } });
			break;
		case 'mute':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { toggleMute: true } } });
			break;

		// ===== 播放控制 =====
		case 'play_pause':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_TOGGLE_PLAY });
			break;

		// ===== 跳转控制 =====
		case 'seek_forward':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: 10 } });
			break;
		case 'seek_backward':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: -10 } });
			break;
		case 'seek_forward_30':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: 30 } });
			break;
		case 'seek_backward_30':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: -30 } });
			break;

		// ===== 速度控制 =====
		case 'speed_up':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { delta: 0.25 } });
			break;
		case 'speed_down':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { delta: -0.25 } });
			break;
		case 'speed_reset':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { speed: 1 } });
			break;

		// ===== 视频控制 =====
		case 'fullscreen':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_FULLSCREEN });
			break;
		case 'pip':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_TOGGLE_PIP });
			break;
	}
}
