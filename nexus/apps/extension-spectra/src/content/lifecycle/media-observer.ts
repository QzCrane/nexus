/**
 * Content Script - 媒体元素观察器
 * 
 * 职责：
 * - 使用 MutationObserver 监听 DOM 变化
 * - 检测新增的 audio/video 元素
 * - 触发策略重新应用
 * 
 * 设计原则：
 * - 带防抖，避免高频触发
 * - 检查扩展上下文有效性
 */

import { AudioMode } from '@nexus/audio-engine';
import { WebAudioController } from '@nexus/audio-engine';
import { isExtensionContextValid } from '../context-guard';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';

/**
 * 创建媒体元素观察器
 * 
 * @param state 状态对象
 * @param audioController WebAudio 控制器
 * @param policyExecutor 策略执行器
 * @returns 清理函数
 */
export function createMediaObserver(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	policyExecutor: PolicyExecutor
): () => void {
	let observerTimeout: ReturnType<typeof setTimeout> | null = null;

	const observer = new MutationObserver(() => {
		// 扩展上下文失效后停止处理
		if (!isExtensionContextValid()) return;

		if (observerTimeout) clearTimeout(observerTimeout);
		observerTimeout = setTimeout(() => {
			// 再次检查，因为是延迟执行
			if (!isExtensionContextValid()) return;

			if (state.activeMode === AudioMode.NATIVE_WEBAUDIO) {
				audioController.scanAndAttach();
			}
			policyExecutor.applyState();
		}, 500);
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	// 返回清理函数
	return () => {
		if (observerTimeout) clearTimeout(observerTimeout);
		observer.disconnect();
	};
}

/**
 * 检测页面是否有媒体元素
 */
export function hasMediaElements(): boolean {
	const audioCount = document.querySelectorAll('audio').length;
	const videoCount = document.querySelectorAll('video').length;
	return audioCount > 0 || videoCount > 0;
}
