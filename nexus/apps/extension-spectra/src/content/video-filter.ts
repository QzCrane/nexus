/**
 * SPECTRA Content Script - 视觉滤镜
 *
 * 职责：视频亮度、对比度、饱和度、灰度、反色等 CSS filter
 */

import { createLogger } from '../shared/logger';

const log = createLogger('VideoFilter');

// ============================================
// 滤镜状态
// ============================================

/** 滤镜配置 */
interface FilterState {
	brightness: number; // 0-200, 100=默认
	contrast: number;   // 0-200, 100=默认
	saturate: number;   // 0-200, 100=默认
	grayscale: boolean;
	invert: boolean;
}

/** 每个视频独立的滤镜状态 */
const filterState = new WeakMap<HTMLVideoElement, FilterState>();

/** 默认滤镜值 */
const DEFAULT_FILTER: FilterState = {
	brightness: 100,
	contrast: 100,
	saturate: 100,
	grayscale: false,
	invert: false
};

/** 获取或初始化滤镜状态 */
function getState(video: HTMLVideoElement): FilterState {
	let state = filterState.get(video);
	if (!state) {
		state = { ...DEFAULT_FILTER };
		filterState.set(video, state);
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
// 滤镜操作
// ============================================

/** 应用 CSS filter */
function applyFilter(video: HTMLVideoElement): void {
	const state = getState(video);
	const filters: string[] = [];

	if (state.brightness !== 100) filters.push(`brightness(${state.brightness}%)`);
	if (state.contrast !== 100) filters.push(`contrast(${state.contrast}%)`);
	if (state.saturate !== 100) filters.push(`saturate(${state.saturate}%)`);
	if (state.grayscale) filters.push('grayscale(100%)');
	if (state.invert) filters.push('invert(100%)');

	video.style.filter = filters.length ? filters.join(' ') : 'none';
	log.info(`Filter applied: ${filters.join(' ') || 'none'}`);
}

/** 设置滤镜 (部分更新) */
export function setVideoFilter(params: Partial<FilterState>): boolean {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	const state = getState(video);
	if (params.brightness !== undefined) state.brightness = Math.max(0, Math.min(200, params.brightness));
	if (params.contrast !== undefined) state.contrast = Math.max(0, Math.min(200, params.contrast));
	if (params.saturate !== undefined) state.saturate = Math.max(0, Math.min(200, params.saturate));
	if (params.grayscale !== undefined) state.grayscale = params.grayscale;
	if (params.invert !== undefined) state.invert = params.invert;

	applyFilter(video);
	return true;
}

/** 重置滤镜 */
export function resetVideoFilter(): boolean {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return false;
	}

	filterState.set(video, { ...DEFAULT_FILTER });
	applyFilter(video);
	return true;
}

// ============================================
// 背景变暗
// ============================================

const DIM_OVERLAY_ID = 'spectra-dim-overlay';
let dimState = { active: false, opacity: 0.7 };

/** 切换背景变暗 */
export function toggleDimBackground(params?: { enabled?: boolean; opacity?: number }): { active: boolean; opacity: number } {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return dimState;
	}

	// 更新状态
	if (params?.enabled !== undefined) dimState.active = params.enabled;
	else dimState.active = !dimState.active;
	if (params?.opacity !== undefined) dimState.opacity = Math.max(0, Math.min(1, params.opacity));

	let overlay = document.getElementById(DIM_OVERLAY_ID);

	if (dimState.active) {
		if (!overlay) {
			overlay = document.createElement('div');
			overlay.id = DIM_OVERLAY_ID;
			overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:#000;';
			document.body.appendChild(overlay);
		}
		overlay.style.opacity = String(dimState.opacity);
		// 提升视频 z-index
		video.style.position = 'relative';
		video.style.zIndex = '2147483647';
		log.info(`Dim background: ON (opacity=${dimState.opacity})`);
	} else {
		if (overlay) overlay.remove();
		video.style.zIndex = '';
		log.info('Dim background: OFF');
	}

	return dimState;
}

