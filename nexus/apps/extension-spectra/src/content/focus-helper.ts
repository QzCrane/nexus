/**
 * 视频焦点辅助工具
 * 
 * 用于全屏/PiP操作后恢复鼠标焦点
 */

import { createLogger } from '../shared/logger';

const log = createLogger('FocusHelper');

/** 模拟用户交互恢复焦点 (全屏/PiP后调用) */
export function simulateMouseHover(video: HTMLVideoElement): void {
	const rect = video.getBoundingClientRect();
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;

	// 确保 video 可聚焦
	if (!video.hasAttribute('tabindex')) {
		video.setAttribute('tabindex', '-1');
	}

	// 1. 模拟鼠标移动
	video.dispatchEvent(new MouseEvent('mousemove', {
		bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));

	// 2. 模拟 mouseenter
	video.dispatchEvent(new MouseEvent('mouseenter', {
		bubbles: false, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));

	// 3. 模拟 mouseover (部分网站依赖此事件)
	video.dispatchEvent(new MouseEvent('mouseover', {
		bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));

	// 4. 聚焦视频
	video.focus();

	// 5. 尝试聚焦视频容器 (部分网站将事件绑定在父元素)
	const container = video.closest('.video-container, .player, [class*="player"], [class*="video"]');
	if (container instanceof HTMLElement) {
		container.focus();
	}

	// 6. 多次重试聚焦 (应对延迟处理)
	setTimeout(() => video.focus(), 100);
	setTimeout(() => video.focus(), 300);

	log.info('Focus recovery attempted on video');
}
