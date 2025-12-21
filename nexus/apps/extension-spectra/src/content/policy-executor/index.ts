/**
 * 策略执行器 - 主入口
 * 
 * 根据 PolicyEngine 计算的模式执行相应的音频处理策略
 * 
 * 策略表:
 * | 场景 | 条件 | 模式 | 颜色 |
 * |-----|------|------|------|
 * | 推荐页预览 | 用户未操作 | 原生模式 | 🔵 蓝 |
 * | 推荐页预览 | 用户已操作音量 | 全音量劫持 | 🟣 紫 |
 * | 播放页 + 非受限 | 任何情况 | 全音量原生 | 🔵 蓝 |
 * | 播放页 + 受限 + 频谱关 | 0-100% | 原生 | 🔵 蓝 |
 * | 播放页 + 受限 + 频谱关 | >100% | 劫持 | 🟣 紫 |
 * | 播放页 + 受限 + 频谱开 | 任何情况 | 全音量劫持 | 🟣 紫 |
 */

import type { AudioConfig } from '@nexus/kernel';
import { AudioMode, type PolicyContext, type UrlInfo } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import { executeMode, hasUserGesture } from '../mode-executor';

// 子模块导入
import type { PolicyExecutor, InternalState } from './types';
import { updateBadge, broadcastUI } from './badge-sync';
import { setupCorsCallback } from './cors-handler';
import { updateConfig } from './config-updater';

const log = logger.content;

/**
 * 创建策略执行器
 * 
 * @param deps 外部依赖注入
 * @param state 共享状态对象
 * @returns 策略执行器实例
 */
export function createPolicyExecutor(deps: PolicyExecutorDeps, state: PolicyExecutorState): PolicyExecutor {
	const { policyEngine, audioController, captureManager, settingsManager } = deps;

	// 内部状态 - 不对外暴露
	const internalState: InternalState = {
		corsStatus: 'PENDING',
		lastBadgeHash: '',
		lastSyncHash: '',
	};

	/**
	 * 获取当前 URL 信息 (适配契约)
	 */
	function getUrlInfo(): UrlInfo {
		return {
			fullUrl: window.location.href,
			domain: window.location.hostname,
			pathname: window.location.pathname,
			isIframe: window.self !== window.top,
		};
	}

	/**
	 * 应用当前策略 - 核心函数
	 */
	function applyState(): void {
		const settings = settingsManager.get();
		const urlInfo = getUrlInfo();
		const restricted = policyEngine.isRestrictedSite(urlInfo.domain);

		const context: PolicyContext = {
			urlInfo,
			enabled: state.config.enabled,
			volume: state.config.volume,
			visualizerEnabled: settings.visualizerEnabled,
			userInteracted: state.userHasInteracted,
			forceNative: internalState.corsStatus === 'SAFE',
			hasMediaElement: true, // 简化处理
			hasAudioContext: audioController.isReady(),
			config: state.config,
		};

		// 防护检查：确保 policyEngine 及其方法仍然有效
		if (!policyEngine || typeof policyEngine.calculateMode !== 'function') {
			log.error('[SPECTRA] policyEngine.calculateMode 无效，回退到 NATIVE_LITE', {
				hasPolicyEngine: !!policyEngine,
				calculateModeType: typeof policyEngine?.calculateMode
			});
			// 回退处理：使用 DOM 控制
			const domVol = state.config.muted ? 0 : Math.min(1, state.config.volume / 100);
			document.querySelectorAll('video, audio').forEach((el) => {
				const media = el as HTMLMediaElement;
				media.volume = domVol;
				media.muted = state.config.muted;
			});
			return;
		}

		const desiredMode = policyEngine.calculateMode(context);

		// 策略调试日志
		log.debug('[SPECTRA] 策略计算:', {
			url: urlInfo.domain + urlInfo.pathname,
			volume: state.config.volume,
			isRestricted: restricted,
			isPlayPage: policyEngine.isVideoPlayPage(urlInfo),
			visualizerEnabled: settings.visualizerEnabled,
			userInteracted: state.userHasInteracted,
			forceNative: internalState.corsStatus === 'SAFE',
			决策结果: desiredMode
		});

		// 模式变更处理
		if (desiredMode !== state.activeMode) {
			log.mode(state.activeMode, desiredMode);

			// 清理旧模式
			if (state.activeMode === AudioMode.NATIVE_WEBAUDIO) {
				audioController.cleanup();
			}
			// 只有在 Capture 真正激活时才发送 OFF 请求
			if (state.activeMode === AudioMode.CAPTURE && desiredMode !== AudioMode.CAPTURE && captureManager.isActive()) {
				log.capture('Mode changing from CAPTURE, sending OFF');
				captureManager.request(false, state.config);
			}

			state.activeMode = desiredMode;
		}

		// 执行当前模式
		executeMode(deps, state);

		// 更新角标和 UI
		updateBadge(deps, state, internalState);
		broadcastUI(deps, state, internalState);
	}

	// 初始化 CORS 回调
	setupCorsCallback(deps, internalState, applyState);

	// 返回公共接口
	return {
		applyState,
		updateBadge: () => updateBadge(deps, state, internalState),
		updateConfig: (changes, options) => updateConfig(deps, state, internalState, changes, options, applyState),
		hasUserGesture: () => hasUserGesture(state),
		markUserInteracted: () => { state.userHasInteracted = true; },
		getActiveMode: () => state.activeMode,
		getUrlInfo,
	};
}

// 导出类型
export type { PolicyExecutor } from './types';
export type { PolicyExecutorState, PolicyExecutorDeps } from '../types';
