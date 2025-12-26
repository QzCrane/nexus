/**
 * 视频焦点辅助工具
 * 
 * 用于全屏/PiP操作后恢复鼠标焦点
 */

import { createLogger } from '../shared/logger';

const log = createLogger('FocusHelper');

/** 执行单次焦点恢复 */
function doFocusRecovery(video: HTMLVideoElement): void {
	const rect = video.getBoundingClientRect();
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;

	// 模拟鼠标事件
	video.dispatchEvent(new MouseEvent('mousemove', {
		bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));
	video.dispatchEvent(new MouseEvent('mouseenter', {
		bubbles: false, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));
	video.dispatchEvent(new MouseEvent('mouseover', {
		bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window,
	}));

	// 聚焦视频
	video.focus();

	// 尝试聚焦容器
	const container = video.closest('.video-container, .player, [class*="player"], [class*="video"]');
	if (container instanceof HTMLElement) {
		container.focus();
	}
}

/** 模拟用户交互恢复焦点 (全屏/PiP进入或退出后调用) */
export function simulateMouseHover(video: HTMLVideoElement): void {
	// 确保 video 可聚焦
	if (!video.hasAttribute('tabindex')) {
		video.setAttribute('tabindex', '-1');
	}

	// 立即执行一次
	doFocusRecovery(video);

	// 多次重试 (覆盖各种延迟场景)
	setTimeout(() => doFocusRecovery(video), 100);
	setTimeout(() => doFocusRecovery(video), 300);
	setTimeout(() => doFocusRecovery(video), 500);
	setTimeout(() => doFocusRecovery(video), 1000);

	log.info('Focus recovery scheduled (5 attempts)');
}
