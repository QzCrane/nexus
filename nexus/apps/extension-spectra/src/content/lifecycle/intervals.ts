/**
 * Content Script - 定时任务管理
 * 
 * 职责：
 * - 定期重应用状态（处理动态内容）
 * - 定期上报媒体元素状态
 * - 扩展上下文失效时自动清理
 */

import { AudioMode } from '@nexus/audio-engine';
import { isExtensionContextValid, safeSend } from '../context-guard';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';
import type { NexusMessenger } from '@nexus/kernel';
import { hasMediaElements } from './media-observer';

const log = logger.content;

/**
 * 定期任务的清理函数集合
 */
interface IntervalCleanup {
	stateReapply: ReturnType<typeof setInterval>;
	mediaReport: ReturnType<typeof setInterval>;
}

/**
 * 创建定期状态重应用任务
 * 
 * @param state 状态对象
 * @param policyExecutor 策略执行器
 * @param onContextInvalid 上下文失效时的回调
 * @returns 定时器 ID
 */
export function createStateReapplyInterval(
	state: PolicyExecutorState,
	policyExecutor: PolicyExecutor,
	onContextInvalid?: () => void
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		// 页面不可见时跳过，节省 CPU
		if (document.hidden) return;

		if (!isExtensionContextValid()) {
			onContextInvalid?.();
			return;
		}

		if (state.activeMode === AudioMode.NATIVE_LITE || state.activeMode === AudioMode.NATIVE_WEBAUDIO) {
			policyExecutor.applyState();
		}
	}, 3000); // 3秒间隔
}

/**
 * 创建媒体状态上报任务
 * 
 * @param messenger 消息器
 * @param onContextInvalid 上下文失效时的回调
 * @returns 定时器 ID
 */
export function createMediaReportInterval(
	messenger: NexusMessenger,
	onContextInvalid?: () => void
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		if (!isExtensionContextValid()) {
			onContextInvalid?.();
			return;
		}
		reportMediaState(messenger);
	}, 5000);
}

/**
 * 上报媒体元素状态到 Background
 */
export function reportMediaState(messenger: NexusMessenger): void {
	if (!isExtensionContextValid()) return;

	const hasMedia = hasMediaElements();
	safeSend(() => messenger.send('TAB_REPORT_MEDIA', { hasMediaElement: hasMedia })).catch(() => {
		// 静默处理
	});
}

/**
 * 清理所有定时任务
 */
export function cleanupIntervals(intervals: Partial<IntervalCleanup>): void {
	if (intervals.stateReapply) clearInterval(intervals.stateReapply);
	if (intervals.mediaReport) clearInterval(intervals.mediaReport);
}
