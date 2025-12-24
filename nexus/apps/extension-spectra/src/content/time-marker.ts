/**
 * SPECTRA Content Script - 时间标记
 *
 * 职责：添加/删除/跳转时间标记点
 */

import { createLogger } from '../shared/logger';

const log = createLogger('Marker');

// ============================================
// 类型定义
// ============================================

interface TimeMarker {
	id: string;
	time: number;
	label: string;
}

// 标记列表（每个页面独立，不持久化）
const markers: TimeMarker[] = [];

/** 生成唯一 ID */
function generateId(): string {
	return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 格式化时间 */
function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
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
// 公共 API
// ============================================

/** 添加标记点 */
export function addMarker(label?: string): TimeMarker | null {
	const video = getPrimaryVideo();
	if (!video) {
		log.warn('No video element found');
		return null;
	}

	const time = video.currentTime;
	const defaultLabel = label || `Mark @ ${formatTime(time)}`;
	const marker: TimeMarker = {
		id: generateId(),
		time,
		label: defaultLabel
	};

	markers.push(marker);
	markers.sort((a, b) => a.time - b.time); // 按时间排序
	log.info(`Added marker: ${marker.label} at ${formatTime(time)}`);
	return marker;
}

/** 删除标记点 */
export function removeMarker(id: string): boolean {
	const index = markers.findIndex(m => m.id === id);
	if (index === -1) {
		log.warn(`Marker not found: ${id}`);
		return false;
	}

	const removed = markers.splice(index, 1)[0];
	if (removed) log.info(`Removed marker: ${removed.label}`);
	return true;
}

/** 跳转到标记点 */
export function jumpToMarker(id: string): { jumped: boolean; time: number } {
	const video = getPrimaryVideo();
	const marker = markers.find(m => m.id === id);

	if (!video || !marker) {
		log.warn(!video ? 'No video element found' : `Marker not found: ${id}`);
		return { jumped: false, time: 0 };
	}

	video.currentTime = marker.time;
	log.info(`Jumped to marker: ${marker.label} (${formatTime(marker.time)})`);
	return { jumped: true, time: marker.time };
}

/** 获取所有标记点 */
export function listMarkers(): TimeMarker[] {
	return [...markers];
}
