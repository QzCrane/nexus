/**
 * 策略执行器 - 角标与 UI 同步
 * 
 * 职责：
 * - 更新扩展图标角标（颜色/文字）
 * - 广播状态给 Popup UI
 * 
 * 设计原则：
 * - 使用 hash 去重，避免高频重复更新
 * - 使用策略预判颜色，保证组件一致性
 */

import { AudioMode, predictCapture } from '@nexus/audio-engine';
import { safeSend } from '../context-guard';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import type { InternalState } from './types';

/**
 * 判断当前是否处于真正的劫持工作状态
 * @deprecated 使用 predictCapture 代替
 */
export function isEffectivelyCapturing(
	state: PolicyExecutorState,
	captureManager: PolicyExecutorDeps['captureManager']
): boolean {
	return state.activeMode === AudioMode.CAPTURE && captureManager.isActive();
}

/**
 * 更新扩展图标角标
 * 
 * 使用策略预判颜色（predictCapture），而非等待 Capture 激活状态
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
	const { messenger, policyEngine, settingsManager } = deps;

	// 使用共享的颜色预判函数
	const isPredictedCapture = predictCapture({
		config: state.config,
		isRestricted: policyEngine.isRestrictedSite(location.hostname),
		visualizerEnabled: settingsManager.get().visualizerEnabled,
	});

	const hash = `${state.config.volume}_${state.config.muted || false}_${isPredictedCapture}`;

	// 只有状态变化时才发送消息，避免高频重复更新
	if (hash === internalState.lastBadgeHash) return;
	internalState.lastBadgeHash = hash;

	safeSend(() => messenger.send('BADGE_UPDATE', {
		volume: state.config.volume,
		muted: state.config.muted,
		isCapture: isPredictedCapture,
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
	const { policyEngine, settingsManager } = deps;

	// 使用共享的颜色预判函数
	const isPredictedCapture = predictCapture({
		config: state.config,
		isRestricted: policyEngine.isRestrictedSite(location.hostname),
		visualizerEnabled: settingsManager.get().visualizerEnabled,
	});

	const syncHash = `${JSON.stringify(state.config)}_${isPredictedCapture}_${state.activeMode}`;

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
				isCaptureActive: isPredictedCapture
			}
		}, {}, (response: any) => {
			if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
			else resolve(response);
		});
	})).catch(() => { });
}
