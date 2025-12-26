/**
 * SPECTRA Remote - 命令执行器
 */

import { Actions } from '@nexus/contracts';

/** 遥控命令类型 */
export type RemoteCommand = 'volume_up' | 'volume_down' | 'mute' | 'play_pause' | 'seek_forward' | 'seek_backward';

/**
 * 执行遥控命令
 */
export function executeCommand(cmd: RemoteCommand, tabId: number): void {
	switch (cmd) {
		case 'volume_up':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { volumeDelta: 10 } });
			break;
		case 'volume_down':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { volumeDelta: -10 } });
			break;
		case 'mute':
			chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { toggleMute: true } });
			break;
		case 'play_pause':
			chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_TOGGLE_PLAY });
			break;
		case 'seek_forward':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, delta: 10 });
			break;
		case 'seek_backward':
			chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, delta: -10 });
			break;
	}
}
