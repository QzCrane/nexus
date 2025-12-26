/**
 * SPECTRA Remote - 命令执行器
 * 
 * 职责：执行遥控命令并获取状态更新
 */

import { Actions } from '@nexus/contracts';

/** 遥控命令类型 */
export type RemoteCommand =
	| 'volume_up' | 'volume_down' | 'volume_max' | 'volume_100' | 'mute'
	| 'play_pause' | 'seek_forward' | 'seek_backward' | 'seek_forward_30' | 'seek_backward_30'
	| 'speed_up' | 'speed_down' | 'speed_reset' | 'fullscreen' | 'pip';

/** 状态回调类型 */
type StateCallback = (state: RemoteState) => void;

/** 遥控器状态 */
export interface RemoteState {
	volume: number;
	muted: boolean;
	playing: boolean;
	speed: number;
	tabTitle?: string;  // 标签页标题
	tabDomain?: string; // 标签页域名
	tabFavIcon?: string; // 标签页图标 URL
}

let stateCallback: StateCallback | null = null;

/** 设置状态回调 */
export function setStateCallback(cb: StateCallback | null): void {
	stateCallback = cb;
}

/** 执行命令并获取状态 */
export async function executeCommand(cmd: RemoteCommand, tabId: number): Promise<void> {
	let response: unknown;

	switch (cmd) {
		// ===== 音量控制 (均破除静音) =====
		case 'volume_up':
			response = await sendToTab(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volumeDelta: 10, muted: false } } });
			break;
		case 'volume_down':
			response = await sendToTab(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volumeDelta: -10, muted: false } } });
			break;
		case 'volume_max':
			response = await sendToTab(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volume: 800, muted: false } } });
			break;
		case 'volume_100':
			response = await sendToTab(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { volume: 100, muted: false } } });
			break;
		case 'mute':
			response = await sendToTab(tabId, { action: Actions.AUDIO_SET_CONFIG, payload: { config: { toggleMute: true } } });
			break;

		// ===== 播放控制 =====
		case 'play_pause':
			await sendToTab(tabId, { action: Actions.MEDIA_TOGGLE_PLAY });
			break;

		// ===== 跳转控制 =====
		case 'seek_forward':
			await sendToTab(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: 10 } });
			break;
		case 'seek_backward':
			await sendToTab(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: -10 } });
			break;
		case 'seek_forward_30':
			await sendToTab(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: 30 } });
			break;
		case 'seek_backward_30':
			await sendToTab(tabId, { action: Actions.VIDEO_SEEK, payload: { delta: -30 } });
			break;

		// ===== 速度控制 =====
		case 'speed_up':
			await sendToTab(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { delta: 0.25 } });
			break;
		case 'speed_down':
			await sendToTab(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { delta: -0.25 } });
			break;
		case 'speed_reset':
			await sendToTab(tabId, { action: Actions.MEDIA_SET_SPEED, payload: { speed: 1 } });
			break;

		// ===== 视频控制 =====
		case 'fullscreen':
			await sendToTab(tabId, { action: Actions.VIDEO_FULLSCREEN });
			break;
		case 'pip':
			await sendToTab(tabId, { action: Actions.MEDIA_TOGGLE_PIP });
			break;
	}

	// 获取更新后的状态
	await syncState(tabId);
}

/** 获取并发送状态 (初始同步/命令后同步) */
export async function syncState(tabId: number): Promise<void> {
	if (!stateCallback) return;

	try {
		// 获取音频状态
		const audioRes = await sendToTab(tabId, { action: Actions.AUDIO_GET_STATUS }) as { config?: { volume?: number; muted?: boolean }; isPlaying?: boolean } | undefined;
		// 获取媒体状态
		const mediaRes = await sendToTab(tabId, { action: Actions.MEDIA_GET_STATE }) as { playing?: boolean; speed?: number } | undefined;

		// 获取标签页信息
		let tabTitle = '';
		let tabDomain = '';
		let tabFavIcon = '';
		try {
			const tab = await chrome.tabs.get(tabId);
			tabTitle = tab.title || '';
			tabDomain = tab.url ? new URL(tab.url).hostname : '';
			tabFavIcon = await fetchFaviconAsDataUrl(tab.favIconUrl || '');
		} catch { /* 静默和忽略错误 */ }

		const state: RemoteState = {
			volume: audioRes?.config?.volume ?? 100,
			muted: audioRes?.config?.muted ?? false,
			playing: mediaRes?.playing ?? audioRes?.isPlaying ?? false,
			speed: mediaRes?.speed ?? 1,
			tabTitle,
			tabDomain,
			tabFavIcon,
		};

		stateCallback(state);
	} catch (e) {
		// 静默失败
	}
}

/** 发送消息到 Tab */
function sendToTab(tabId: number, message: object): Promise<unknown> {
	return new Promise((resolve) => {
		chrome.tabs.sendMessage(tabId, message, {}, (response: unknown) => {
			resolve(response);
		});
	});
}

/** Fetch favicon url to base64 data uri */
async function fetchFaviconAsDataUrl(url: string): Promise<string> {
	if (!url) return '';
	// Skip data URIs, they are already good
	if (url.startsWith('data:')) return url;

	try {
		// 使用 fetch 获取图片数据
		const response = await fetch(url);
		const blob = await response.blob();

		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = () => resolve(''); // Fallback to empty
			reader.readAsDataURL(blob);
		});
	} catch (err) {
		return ''; // Fetch failed, fallback to empty (client might use google S2)
	}
}
