/**
 * 策略执行器 - 角标与 UI 同步
 * 
 * 角标显示规则（v4）：
 * - 用户通过插件UI操作任何配置 → 激活 sticky → 显示角标
 * - 网站自己调节 → 不显示
 * - 只打开UI不操作 → 不显示
 * - 捕获模式自动激活 sticky
 * - 一旦 sticky 激活，该标签页永久显示角标
 */

import { AudioMode, predictCapture } from '@nexus/audio-engine';
import { Actions } from '@nexus/contracts';
import { safeSend } from '../context-guard';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import type { InternalState } from './types';

/** @deprecated 使用 predictCapture 代替 */
export function isEffectivelyCapturing(
	state: PolicyExecutorState,
	captureManager: PolicyExecutorDeps['captureManager']
): boolean {
	return state.activeMode === AudioMode.CAPTURE && captureManager.isActive();
}

/** 更新扩展图标角标 */
export function updateBadge(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	internalState: InternalState
): void {
	const { messenger, settingsManager } = deps;
	const isRestricted = internalState.corsStatus === 'RESTRICTED';

	const isPredictedCapture = predictCapture({
		config: state.config,
		isRestricted,
		visualizerEnabled: settingsManager.get().visualizerEnabled,
	});

	// 捕获模式自动激活 sticky（其他配置变化由 config-updater.ts 处理）
	if (isPredictedCapture) {
		state.userHasInteracted = true;
	}

	const hash = `${state.config.volume}_${state.config.muted || false}_${isPredictedCapture}_${state.userHasInteracted}`;
	if (hash === internalState.lastBadgeHash) return;
	internalState.lastBadgeHash = hash;

	safeSend(() => messenger.send('BADGE_UPDATE', {
		volume: state.config.volume,
		muted: state.config.muted,
		isCapture: isPredictedCapture,
		userInteracted: state.userHasInteracted,
	} as any)).catch(() => { });
}

/** 广播状态给 Popup UI */
export function broadcastUI(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	internalState: InternalState
): void {
	const { settingsManager } = deps;
	const isRestricted = internalState.corsStatus === 'RESTRICTED';

	const isPredictedCapture = predictCapture({
		config: state.config,
		isRestricted,
		visualizerEnabled: settingsManager.get().visualizerEnabled,
	});

	const syncHash = `${JSON.stringify(state.config)}_${isPredictedCapture}_${state.activeMode}`;
	if (syncHash === internalState.lastSyncHash) return;
	internalState.lastSyncHash = syncHash;

	safeSend(() => new Promise<void>((resolve, reject) => {
		chrome.runtime.sendMessage({
			action: Actions.UI_SYNC,
			payload: {
				config: state.config,
				mode: state.activeMode as any,
				isCaptureActive: isPredictedCapture,
				isRestricted,
			}
		}, {}, (response: any) => {
			if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
			else resolve(response);
		});
	})).catch(() => { });
}
