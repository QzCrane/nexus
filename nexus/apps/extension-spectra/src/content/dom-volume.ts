/**
 * SPECTRA Content Script - DOM 音量控制
 * 
 * 负责直接设置页面中媒体元素的音量
 * 增强版：支持音量锁定，防止外部脚本覆盖
 */

import { logger } from '../shared/logger';

const log = logger.content;

/** 已锁定音量的媒体元素集合 (WeakSet 防止内存泄漏) */
const lockedElements = new WeakSet<HTMLMediaElement>();

/** 当前锁定的目标音量 */
let targetVolume = 1;
let targetMuted = false;

/** 音量锁是否激活 (WebAudio/Capture 接管时应禁用) */
let lockEnabled = true;

/**
 * 设置所有媒体元素的 DOM 音量
 * @param volume - 音量值 (0-1)
 * @param muted - 是否静音
 */
export function setDomVolume(volume: number, muted: boolean): void {
	// 更新目标值
	targetVolume = volume;
	targetMuted = muted;

	const mediaElements = document.querySelectorAll('video, audio');
	let applied = 0;

	mediaElements.forEach((el) => {
		const media = el as HTMLMediaElement;

		// 设置音量
		if (Math.abs(media.volume - volume) > 0.01) {
			try {
				media.volume = volume;
				applied++;
			} catch (e) {
				// 某些媒体元素可能不支持设置音量
				log.debug('[DOM] 无法设置音量:', e);
			}
		}

		// 设置静音
		if (media.muted !== muted) {
			try {
				media.muted = muted;
			} catch (e) {
				log.debug('[DOM] 无法设置静音:', e);
			}
		}

		// 为新元素添加音量保护监听器
		if (!lockedElements.has(media)) {
			setupVolumeLock(media);
			lockedElements.add(media);
		}
	});

	// 调试日志 (仅在有变化时输出)
	if (applied > 0) {
		log.debug(`[DOM] 音量应用: ${(volume * 100).toFixed(0)}% (静音: ${muted}) → ${applied}/${mediaElements.length} 个元素`);
	}
}

/**
 * 为媒体元素设置音量锁定监听器
 * 当外部脚本尝试修改音量时，自动恢复到目标值
 */
function setupVolumeLock(media: HTMLMediaElement): void {
	media.addEventListener('volumechange', () => {
		// WebAudio/Capture 接管时不恢复音量
		if (!lockEnabled) return;

		// 检查音量是否被外部修改
		const volumeDiff = Math.abs(media.volume - targetVolume);
		const mutedDiff = media.muted !== targetMuted;

		if (volumeDiff > 0.01 || mutedDiff) {
			// 延迟恢复，避免死循环
			requestAnimationFrame(() => {
				if (!lockEnabled) return;
				if (Math.abs(media.volume - targetVolume) > 0.01) {
					log.debug('[DOM] 检测到音量被外部修改，恢复到:', (targetVolume * 100).toFixed(0) + '%');
					media.volume = targetVolume;
				}
				if (media.muted !== targetMuted) {
					media.muted = targetMuted;
				}
			});
		}
	});
}

/**
 * 检测是否有媒体元素
 */
export function hasMediaElements(): boolean {
	return document.querySelectorAll('video, audio').length > 0;
}

// 重导出暂停追踪功能
export { getPausedAt } from './pause-tracker';
import { updatePausedAt, needsTracking, setupPauseTracking } from './pause-tracker';

/**
 * 检测是否有正在播放的媒体
 * 同时更新暂停时间戳
 */
export function isAnyMediaPlaying(): boolean {
	const elements = document.querySelectorAll('video, audio');
	let hasPlaying = false;

	for (const el of elements) {
		const media = el as HTMLMediaElement;
		if (!media.paused) hasPlaying = true;

		// 为新媒体元素添加暂停追踪
		if (needsTracking(media)) {
			setupPauseTracking(media, isAnyMediaPlayingRaw);
		}
	}

	// 更新暂停时间戳
	updatePausedAt(hasPlaying, elements.length > 0);

	return hasPlaying;
}

/**
 * 原始检测 (不更新 pausedAt)
 */
function isAnyMediaPlayingRaw(): boolean {
	const elements = document.querySelectorAll('video, audio');
	for (const el of elements) {
		if (!(el as HTMLMediaElement).paused) return true;
	}
	return false;
}

/**
 * 释放音量锁定 (WebAudio/Capture 接管时调用)
 * 
 * 将 DOM 音量设为 1 并禁用自动恢复，让高级模式完全控制音频
 */
export function releaseVolumeLock(): void {
	lockEnabled = false;
	targetVolume = 1;
	targetMuted = false;
	// 将所有媒体元素 DOM 音量设为 1，由高级模式通过 GainNode 控制实际音量
	document.querySelectorAll('video, audio').forEach((el) => {
		const media = el as HTMLMediaElement;
		try {
			media.volume = 1;
			media.muted = false;
		} catch {
			// 静默处理
		}
	});
}

/**
 * 重新启用音量锁定 (回退到 NATIVE_LITE 时调用)
 */
export function enableVolumeLock(volume: number, muted: boolean): void {
	lockEnabled = true;
	setDomVolume(volume, muted);
}

