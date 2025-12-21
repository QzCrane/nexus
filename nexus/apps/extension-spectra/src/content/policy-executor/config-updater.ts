/**
 * 策略执行器 - 配置更新
 * 
 * 职责：
 * - 提供统一的配置更新接口
 * - 处理联动逻辑（如音量变化时解除静音）
 * - 触发 OSD 显示和状态持久化
 * 
 * 设计原则：
 * - 单一入口，避免配置更新分散在各处
 * - 明确的副作用控制（通过 options 参数）
 */

import type { AudioConfig } from '@nexus/kernel';
import { showOSD } from '../osd';
import { safeSend } from '../context-guard';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import type { InternalState } from './types';
import { updateBadge, isEffectivelyCapturing } from './badge-sync';

/**
 * 统一配置更新接口 - 解决静音/恢复逻辑冲突的核心架构
 * 
 * @param deps 依赖对象
 * @param state 执行器状态
 * @param internalState 内部状态
 * @param changes 配置修改项
 * @param options 控制选项
 * @param applyStateFn 应用状态的回调函数
 */
export function updateConfig(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	internalState: InternalState,
	changes: Partial<AudioConfig>,
	options: { showOSD?: boolean; unMute?: boolean } = {},
	applyStateFn: () => void
): void {
	const { messenger, captureManager, settingsManager } = deps;

	// 1. 标记用户已交互 (用于策略判定)
	state.userHasInteracted = true;

	// 2. 联动逻辑：如果指定了解除静音，或者音量发生了变化 (且非显式静音操作)，则解除静音
	const newConfig = { ...state.config, ...changes };

	if (options.unMute) {
		newConfig.muted = false;
	}

	// 3. 应用并保存状态
	state.config = newConfig;
	applyStateFn();
	updateBadge(deps, state, internalState);

	// 4. 触发显示和同步
	if (options.showOSD) {
		showOSD(
			state.config,
			isEffectivelyCapturing(state, captureManager),
			settingsManager.get(),
			state.isPopupOpen
		);
	}

	// 5. 将配置持久化到 Background
	safeSend(() => messenger.send('AUDIO_SET_CONFIG', { config: state.config })).catch(() => { });
}
