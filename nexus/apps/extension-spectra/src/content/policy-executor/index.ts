/**
 * 策略执行器 - 主入口
 * 
 * 根据 PolicyEngine 计算的模式执行相应的音频处理策略
 * 
 */

import type { AudioConfig } from '@nexus/kernel';
import { AudioMode, type PolicyContext, type UrlInfo } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import { executeMode, hasUserGesture } from '../mode-executor';

// 子模块导入
import type { PolicyExecutor, InternalState } from './types';
import { updateBadge, broadcastUI } from './badge-sync';
import { setupCorsCallback, probeCorsOnMediaDetected, initCorsStatus } from './cors-handler';
import { updateConfig } from './config-updater';

const log = logger.content;

/**
 * 创建策略执行器
 * 
 * @param deps 外部依赖注入
 * @param state 共享状态对象
 * @returns 策略执行器实例
 */
export async function createPolicyExecutor(deps: PolicyExecutorDeps, state: PolicyExecutorState): Promise<PolicyExecutor> {
	const { policyEngine, audioController, captureManager, settingsManager } = deps;

	// 从注册表初始化 CORS 状态
	const initialCorsStatus = await initCorsStatus(deps.messenger);

	// 内部状态 - 不对外暴露
	const internalState: InternalState = {
		corsStatus: initialCorsStatus,
		lastBadgeHash: '',
		lastSyncHash: '',
	};

	log.debug(`[SPECTRA] CORS 初始化: ${initialCorsStatus}`);

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

		// 受限站点判断：CORS 检测结果决定
		// PENDING 也视为受限（保守策略：首次访问跨域站点避免短暂无声）
		const isRestricted = internalState.corsStatus !== 'SAFE';

		const context: PolicyContext = {
			urlInfo,
			enabled: state.config.enabled,
			volume: state.config.volume,
			visualizerEnabled: settings.visualizerEnabled,
			userInteracted: state.userHasInteracted,
			forceNative: internalState.corsStatus === 'SAFE',
			isRestricted,
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
			isRestricted,
			visualizerEnabled: settings.visualizerEnabled,
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

	// CORS 预检测：发现音频时立即检测，结果缓存到注册表
	probeCorsOnMediaDetected(deps.messenger, internalState, applyState);

	// 返回公共接口
	return {
		applyState,
		updateBadge: () => updateBadge(deps, state, internalState),
		updateConfig: (changes, options) => updateConfig(deps, state, internalState, changes, options, applyState),
		hasUserGesture: () => hasUserGesture(state),
		markUserInteracted: () => { state.userHasInteracted = true; },
		getActiveMode: () => state.activeMode,
		getUrlInfo,
		probeCors: () => probeCorsOnMediaDetected(deps.messenger, internalState, applyState),
	};
}

// 导出类型
export type { PolicyExecutor } from './types';
export type { PolicyExecutorState, PolicyExecutorDeps } from '../types';
