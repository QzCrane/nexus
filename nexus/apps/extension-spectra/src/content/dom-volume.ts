/**
 * SPECTRA Content Script - DOM 音量控制 (跟随模式)
 * 网站原生音量优先，插件配置跟随同步
 */

import { logger } from '../shared/logger';

const log = logger.content;
const monitoredElements = new WeakSet<HTMLMediaElement>();
let targetVolume = 1, targetMuted = false;
let syncEnabled = true, settingByPlugin = false;
let onNativeVolumeChange: ((volume: number, muted: boolean) => void) | null = null;

/** 注册原生音量变化回调 */
export function setNativeVolumeCallback(cb: (volume: number, muted: boolean) => void): void {
	onNativeVolumeChange = cb;
}

/** 设置所有媒体元素的 DOM 音量 */
export function setDomVolume(volume: number, muted: boolean): void {
	targetVolume = volume;
	targetMuted = muted;
	const els = document.querySelectorAll('video, audio');
	let applied = 0;
	settingByPlugin = true;

	els.forEach((el) => {
		const m = el as HTMLMediaElement;
		if (Math.abs(m.volume - volume) > 0.01) {
			try { m.volume = volume; applied++; } catch { /* 忽略 */ }
		}
		if (m.muted !== muted) {
			try { m.muted = muted; } catch { /* 忽略 */ }
		}
		if (!monitoredElements.has(m)) {
			setupVolumeMonitor(m);
			monitoredElements.add(m);
		}
	});

	// 🔴 使用 setTimeout 替代 requestAnimationFrame，增加防抖时间
	setTimeout(() => { settingByPlugin = false; }, 100);
	if (applied > 0) log.debug(`[DOM] 音量应用: ${(volume * 100).toFixed(0)}% → ${applied}/${els.length}`);
}

/** 音量监听器：跟随网站原生音量变化 */
function setupVolumeMonitor(media: HTMLMediaElement): void {
	media.addEventListener('volumechange', () => {
		if (settingByPlugin) return;
		const newVol = media.volume, newMuted = media.muted;
		const volDiff = Math.abs(newVol - targetVolume), muteDiff = newMuted !== targetMuted;

		// 高级模式：只处理静音切换
		if (!syncEnabled) {
			if (muteDiff) {
				targetMuted = newMuted;
				log.debug(`[DOM] 高级模式静音切换: ${newMuted}`);
				// 🔴 始终发送 -1 表示不修改音量，避免错误地把 volume 设为 0
				onNativeVolumeChange?.(-1, newMuted);
			}
			return;
		}

		// NATIVE_LITE：完整同步
		if (volDiff > 0.01 || muteDiff) {
			targetVolume = newVol;
			targetMuted = newMuted;
			log.debug(`[DOM] 原生音量: ${(newVol * 100).toFixed(0)}% (静音: ${newMuted})`);
			onNativeVolumeChange?.(newVol, newMuted);
		}
	});
}

export function hasMediaElements(): boolean {
	return document.querySelectorAll('video, audio').length > 0;
}

// 重导出暂停追踪
export { getPausedAt } from './pause-tracker';
import { updatePausedAt, needsTracking, setupPauseTracking } from './pause-tracker';

/** 检测是否有正在播放的媒体 */
export function isAnyMediaPlaying(): boolean {
	const els = document.querySelectorAll('video, audio');
	let hasPlaying = false;
	for (const el of els) {
		const m = el as HTMLMediaElement;
		if (!m.paused) hasPlaying = true;
		if (needsTracking(m)) setupPauseTracking(m, isAnyMediaPlayingRaw);
	}
	updatePausedAt(hasPlaying, els.length > 0);
	return hasPlaying;
}

function isAnyMediaPlayingRaw(): boolean {
	for (const el of document.querySelectorAll('video, audio')) {
		if (!(el as HTMLMediaElement).paused) return true;
	}
	return false;
}

/** 释放音量同步 (高级模式接管) */
export function releaseVolumeLock(): void {
	syncEnabled = false;
	settingByPlugin = true;  // 🔴 阻止 volumechange 回调
	targetVolume = 1;
	targetMuted = false;
	document.querySelectorAll('video, audio').forEach((el) => {
		try { (el as HTMLMediaElement).volume = 1; (el as HTMLMediaElement).muted = false; } catch { }
	});
	setTimeout(() => { settingByPlugin = false; }, 100);
}

/** 重新启用音量同步 (回退到 NATIVE_LITE) */
export function enableVolumeLock(volume: number, muted: boolean): void {
	syncEnabled = true;
	setDomVolume(volume, muted);
}
