/**
 * SPECTRA Content Script - 视频变换
 *
 * 职责：视频旋转、镜像、截图功能
 * 使用 CSS transform 实现视觉变换，不修改视频源
 */

import { createLogger } from '../shared/logger';
import { simulateMouseHover } from './focus-helper';

const log = createLogger('VideoTransform');

// ============================================
// 状态管理
// ============================================

/** 当前变换状态 (每个视频元素独立) */
const transformState = new WeakMap<HTMLVideoElement, { rotation: number; mirrored: boolean }>();

/** 获取或初始化变换状态 */
function getState(video: HTMLVideoElement): { rotation: number; mirrored: boolean } {
	let state = transformState.get(video);
	if (!state) {
		state = { rotation: 0, mirrored: false };
		transformState.set(video, state);
	}
	return state;
}

/** 获取主视频元素 */
function getPrimaryVideo(): HTMLVideoElement | null {
	const videos = Array.from(document.querySelectorAll('video'));
	if (!videos.length) return null;

	const visible = videos.filter(v => {
		const rect = v.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	});

	if (!visible.length) return videos[0] ?? null;

	visible.sort((a, b) => {
		const aRect = a.getBoundingClientRect();
		const bRect = b.getBoundingClientRect();
		return (bRect.width * bRect.height) - (aRect.width * aRect.height);
	});

	return visible[0] ?? null;
}

// ============================================
// 变换操作
// ============================================

/** 应用 CSS transform */
function applyTransform(video: HTMLVideoElement): void {
	const state = getState(video);
	const transforms: string[] = [];

	if (state.rotation !== 0) {
		transforms.push(`rotate(${state.rotation}deg)`);
	}
	if (state.mirrored) {
		transforms.push('scaleX(-1)');
	}

	video.style.transform = transforms.join(' ') || 'none';
	log.info(`Transform applied: rotation=${state.rotation}, mirrored=${state.mirrored}`);
}

/** 旋转视频 (每次 +90°) */
export function rotateVideo(): number {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return 0;
	}

	const state = getState(video);
	state.rotation = (state.rotation + 90) % 360;
	applyTransform(video);
	return state.rotation;
}

/** 切换镜像 */
export function toggleMirror(): boolean {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	const state = getState(video);
	state.mirrored = !state.mirrored;
	applyTransform(video);
	return state.mirrored;
}

/** 截图并返回 dataUrl */
export function takeScreenshot(): string | null {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return null;
	}

	try {
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		// 应用变换到画布
		const state = getState(video);
		ctx.save();

		// 移动到中心
		ctx.translate(canvas.width / 2, canvas.height / 2);

		// 应用旋转
		if (state.rotation !== 0) {
			ctx.rotate((state.rotation * Math.PI) / 180);
		}

		// 应用镜像
		if (state.mirrored) {
			ctx.scale(-1, 1);
		}

		// 绘制视频
		ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
		ctx.restore();

		const dataUrl = canvas.toDataURL('image/png');
		log.info(`Screenshot taken: ${canvas.width}x${canvas.height}`);

		// 自动触发下载
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `screenshot_${Date.now()}.png`;
		link.click();

		return dataUrl;
	} catch (e) {
		log.error('Screenshot failed:', e);
		return null;
	}
}


/** 切换全屏 */
export async function toggleFullscreen(): Promise<boolean> {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	try {
		let result: boolean;
		if (document.fullscreenElement === video) {
			await document.exitFullscreen();
			result = false;
		} else {
			await video.requestFullscreen();
			result = true;
		}
		// 延迟恢复焦点 (等待全屏/退出动画完成)
		setTimeout(() => simulateMouseHover(video), 200);
		return result;
	} catch (e) {
		log.error('Fullscreen toggle failed:', e);
		return false;
	}
}

/** 裁剪状态 */
const cropState = new WeakMap<HTMLVideoElement, boolean>();

/** 切换去黑边 (object-fit: cover) */
export function toggleCrop(): boolean {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	const isCropped = cropState.get(video) ?? false;
	const newCropped = !isCropped;

	// cover = 裁剪填满，contain = 保持比例留黑边
	video.style.objectFit = newCropped ? 'cover' : 'contain';
	cropState.set(video, newCropped);

	log.info(`Crop mode: ${newCropped ? 'cover' : 'contain'}`);
	return newCropped;
}
