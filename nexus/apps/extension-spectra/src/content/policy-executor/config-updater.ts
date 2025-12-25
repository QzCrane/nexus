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
import { predictCapture } from '@nexus/audio-engine';
import { showOSD } from '../osd';
import { safeSend } from '../context-guard';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import type { InternalState } from './types';
import { updateBadge } from './badge-sync';

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
	const { messenger, settingsManager } = deps;

	// 1. 标记用户已交互 (用于策略判定)
	// 规则：开关 UI 行为不应激活角标，排除单纯的 enabled 变化，仅当其他配置项真正发生改变时激活
	const isOperation = Object.entries(changes).some(([k, v]) => {
		if (k === 'enabled') return false;
		// 只有当值确实发生变化时才认为是操作 (防止全量同步触发误判)
		return v !== (state.config as any)[k];
	});

	if (isOperation) {
		state.userHasInteracted = true;
	}

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
		const settings = settingsManager.get();
		// 🔴 使用 internalState.corsStatus 判断，与 badge-sync 保持一致
		const isRestricted = internalState.corsStatus === 'RESTRICTED';
		const predictedCapture = predictCapture({
			config: newConfig,
			isRestricted,
			visualizerEnabled: settings.visualizerEnabled,
		});

		showOSD(
			state.config,
			predictedCapture,
			settings,
			state.isPopupOpen
		);
	}

	// 5. 将配置持久化到 Background
	safeSend(() => messenger.send('AUDIO_SET_CONFIG', { config: state.config })).catch(() => { });
}

