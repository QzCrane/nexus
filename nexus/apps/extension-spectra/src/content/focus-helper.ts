/**
 * 视频焦点辅助工具
 * 
 * 用于全屏/PiP操作后恢复鼠标焦点
 */

import { createLogger } from '../shared/logger';

const log = createLogger('FocusHelper');

/** 模拟鼠标移动到视频中心 (恢复焦点) */
export function simulateMouseHover(video: HTMLVideoElement): void {
	const rect = video.getBoundingClientRect();
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;

	// 确保 video 可聚焦
	if (!video.hasAttribute('tabindex')) {
		video.setAttribute('tabindex', '-1');
	}

	// 模拟鼠标移动事件
	const moveEvent = new MouseEvent('mousemove', {
		bubbles: true,
		cancelable: true,
		clientX: centerX,
		clientY: centerY,
		view: window,
	});
	video.dispatchEvent(moveEvent);

	// 模拟 mouseenter 事件
	const enterEvent = new MouseEvent('mouseenter', {
		bubbles: false,
		cancelable: true,
		clientX: centerX,
		clientY: centerY,
		view: window,
	});
	video.dispatchEvent(enterEvent);

	// 聚焦视频元素
	video.focus();
	log.info('Simulated mouse hover on video');
}
