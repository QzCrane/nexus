/**
 * SPECTRA Content Script - 媒体控制
 *
 * 职责：提供视频暂停/播放、画中画、速率控制等操作
 * 优先操作主视频（最大的可见 video 元素）
 */

import { createLogger } from '../shared/logger';

const log = createLogger('MediaControl');

// ============================================
// 核心工具函数
// ============================================

/** 获取主视频元素 (最大的可见 video) */
function getPrimaryVideo(): HTMLVideoElement | null {
	const videos = Array.from(document.querySelectorAll('video'));
	if (!videos.length) return null;

	// 按面积排序，取最大的可见视频
	const visible = videos.filter(v => {
		const rect = v.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	});

	if (!visible.length) return videos[0] ?? null; // fallback 到第一个

	visible.sort((a, b) => {
		const aRect = a.getBoundingClientRect();
		const bRect = b.getBoundingClientRect();
		return (bRect.width * bRect.height) - (aRect.width * aRect.height);
	});

	return visible[0] ?? null;
}

/** 获取所有媒体元素 */
function getAllMedia(): HTMLMediaElement[] {
	return [
		...Array.from(document.querySelectorAll('video')),
		...Array.from(document.querySelectorAll('audio')),
	];
}

// ============================================
// 媒体操作函数
// ============================================

/** 切换播放/暂停 */
export function togglePlay(): boolean {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	if (video.paused) {
		video.play().catch(e => log.error('Play failed:', e));
		return true;
	} else {
		video.pause();
		return false;
	}
}

/** 切换画中画 */
export async function togglePip(): Promise<boolean> {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	try {
		if (document.pictureInPictureElement === video) {
			await document.exitPictureInPicture();
			return false;
		} else {
			// 先退出当前 PiP（如有）
			if (document.pictureInPictureElement) {
				await document.exitPictureInPicture();
			}
			await video.requestPictureInPicture();
			return true;
		}
	} catch (e) {
		log.error('PiP toggle failed:', e);
		return false;
	}
}

/** 设置播放速率 */
export function setSpeed(speed: number): number {
	const clampedSpeed = Math.max(0.1, Math.min(16, speed));
	const medias = getAllMedia();

	medias.forEach(m => {
		m.playbackRate = clampedSpeed;
	});

	log.info(`Speed set to ${clampedSpeed}x`);
	return clampedSpeed;
}

/** 调整速率（增量） */
export function adjustSpeed(delta: number): number {
	const video = getPrimaryVideo();
	const currentSpeed = video?.playbackRate ?? 1;
	return setSpeed(currentSpeed + delta);
}

/** 获取当前媒体状态 */
export function getMediaState(): { playing: boolean; speed: number; pipActive: boolean } {
	const video = getPrimaryVideo();
	return {
		playing: video ? !video.paused : false,
		speed: video?.playbackRate ?? 1,
		pipActive: !!document.pictureInPictureElement,
	};
}
