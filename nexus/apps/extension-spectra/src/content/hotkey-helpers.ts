/**
 * SPECTRA Content Script - 快捷键辅助函数
 *
 * 通过消息通道与 Background 通信的辅助函数
 */

import type { HotkeyAction, HotkeyParams, AudioConfig } from '@nexus/contracts';
import { Actions } from '@nexus/contracts';
import { listMarkers } from './time-marker';
import { showToast } from './toast';

// 状态缓存 (用于获取当前音量等)
let cachedConfig: Partial<AudioConfig> = { volume: 100, muted: false };

/** 设置缓存配置 (由外部模块调用) */
export function setCachedConfig(config: Partial<AudioConfig>): void {
	cachedConfig = { ...cachedConfig, ...config };
}

/** 发送音量动作 */
export function sendVolumeAction(action: HotkeyAction, params?: HotkeyParams): void {
	const step = params?.step ?? 10;
	let newConfig: Partial<AudioConfig> = {};

	switch (action) {
		case 'volume_up':
			newConfig = { volume: Math.min(800, (cachedConfig.volume ?? 100) + step) };
			break;
		case 'volume_down':
			newConfig = { volume: Math.max(0, (cachedConfig.volume ?? 100) - step) };
			break;
		case 'volume_mute':
			newConfig = { muted: !cachedConfig.muted };
			break;
		case 'volume_set':
			if (params?.volume !== undefined) newConfig = { volume: params.volume };
			break;
	}

	chrome.runtime.sendMessage({
		action: Actions.AUDIO_SET_CONFIG,
		payload: newConfig
	});
}

/** 发送音频重置 */
export function sendAudioReset(): void {
	chrome.runtime.sendMessage({
		action: Actions.AUDIO_SET_CONFIG,
		payload: { volume: 100, muted: false, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, compressor: 0 }
	});
}

/** 发送 Capture 切换 */
export function sendCaptureToggle(): void {
	chrome.runtime.sendMessage({ action: Actions.CAPTURE_TOGGLE });
}

/** 跳转到标记点 */
export function jumpMarker(forward: boolean): void {
	const markers = listMarkers();
	if (!markers.length) return;
	const video = document.querySelector('video');
	if (!video) return;
	const currentTime = video.currentTime;

	if (forward) {
		const next = markers.find(m => m.time > currentTime + 0.5);
		if (next) {
			video.currentTime = next.time;
			showToast(`Jump to ${next.label}`);
		}
	} else {
		const prev = [...markers].reverse().find(m => m.time < currentTime - 0.5);
		if (prev) {
			video.currentTime = prev.time;
			showToast(`Jump to ${prev.label}`);
		}
	}
}

/** 切换视频循环 */
export function toggleLoop(): void {
	const video = document.querySelector('video');
	if (video) {
		video.loop = !video.loop;
		showToast(video.loop ? 'Loop ON' : 'Loop OFF');
	}
}

/** 发送标签页动作 */
export function sendTabAction(action: HotkeyAction): void {
	chrome.runtime.sendMessage({ action: action === 'tab_pin' ? 'TAB_PIN' : 'TAB_MUTE' });
}
