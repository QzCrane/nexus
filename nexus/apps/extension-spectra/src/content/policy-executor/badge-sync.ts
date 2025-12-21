/**
 * 策略执行器 - 角标与 UI 同步
 * 
 * 职责：
 * - 更新扩展图标角标（颜色/文字）
 * - 广播状态给 Popup UI
 * 
 * 设计原则：
 * - 使用 hash 去重，避免高频重复更新
 * - 使用 safeSend 防止扩展重载错误
 */

import { AudioMode } from '@nexus/audio-engine';
import { safeSend } from '../context-guard';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import type { InternalState } from './types';

/**
 * 判断当前是否处于真正的劫持工作状态
 */
export function isEffectivelyCapturing(
	state: PolicyExecutorState,
	captureManager: PolicyExecutorDeps['captureManager']
): boolean {
	return state.activeMode === AudioMode.CAPTURE && captureManager.isActive();
}

/** 首次角标更新延迟 (ms)，等待 Capture 激活完成 */
const FIRST_BADGE_DELAY_MS = 500;

/** 是否已完成首次延迟 */
let firstBadgeDelayDone = false;

/**
 * 更新扩展图标角标
 * 
 * 优化策略：
 * - 使用 hash 去重，避免高频重复更新
 * - 首次更新延迟 500ms，等待 Capture 激活完成，避免蓝→紫闪烁
 * 
 * @param deps 依赖对象
 * @param state 执行器状态
 * @param internalState 内部状态（用于 hash 去重）
 */
export function updateBadge(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	internalState: InternalState
): void {
	const { messenger, captureManager } = deps;
	const effectivelyCapturing = isEffectivelyCapturing(state, captureManager);
	const hash = `${state.config.volume}_${state.config.muted || false}_${effectivelyCapturing}`;

	// 只有状态变化时才发送消息，避免高频刷新导致角标闪烁
	if (hash === internalState.lastBadgeHash) return;

	// 首次更新时延迟发送，等待 Capture 激活完成
	if (!firstBadgeDelayDone && !captureManager.isActive()) {
		setTimeout(() => {
			firstBadgeDelayDone = true;
			// 延迟后重新触发更新
			updateBadge(deps, state, internalState);
		}, FIRST_BADGE_DELAY_MS);
		return;
	}
	firstBadgeDelayDone = true;

	internalState.lastBadgeHash = hash;

	safeSend(() => messenger.send('BADGE_UPDATE', {
		volume: state.config.volume,
		muted: state.config.muted,
		isCapture: effectivelyCapturing,
	})).catch(() => { });
}

/**
 * 广播状态给 Popup UI
 * 
 * @param deps 依赖对象
 * @param state 执行器状态
 * @param internalState 内部状态（用于 hash 去重）
 */
export function broadcastUI(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	internalState: InternalState
): void {
	const { captureManager } = deps;
	const effectivelyCapturing = isEffectivelyCapturing(state, captureManager);
	const syncHash = `${JSON.stringify(state.config)}_${effectivelyCapturing}_${state.activeMode}`;

	// 只有状态变化时才发送消息，避免高频刷新导致 UI 闪烁/性能问题
	if (syncHash === internalState.lastSyncHash) return;
	internalState.lastSyncHash = syncHash;

	// 使用 safeSend 防止扩展重载后的 Context Invalidated 报错
	safeSend(() => new Promise<void>((resolve, reject) => {
		chrome.runtime.sendMessage({
			action: 'UI_SYNC',
			payload: {
				config: state.config,
				mode: state.activeMode as any,
				isCaptureActive: effectivelyCapturing
			}
		}, {}, (response: any) => {
			if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
			else resolve(response);
		});
	})).catch(() => { });
}
