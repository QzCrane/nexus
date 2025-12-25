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
import { executeMode, hasUserGesture, initModeExecutorCallbacks } from '../mode-executor';

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

	// 显示 CORS 初始化状态
	const statusDesc = initialCorsStatus === 'PENDING' ? '未知(需检测)'
		: initialCorsStatus === 'SAFE' ? '安全(已缓存)' : '受限(已缓存)';
	log.info(`[CORS] 初始化: ${initialCorsStatus} (${statusDesc})`);

	// 如果 CORS 状态已知（缓存命中），跳过重复检测
	if (initialCorsStatus !== 'PENDING') {
		audioController.setSkipCorsCheck(true);
	}

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

		// 受限站点判断 (v3.6)：只有确认 RESTRICTED 才使用 CAPTURE
		// PENDING 状态尝试 NATIVE_WEBAUDIO 来触发 CORS 检测
		const isRestricted = internalState.corsStatus === 'RESTRICTED';

		// 用户已交互 + CORS 未知 → 需要触发 CORS 检测
		// 强制 needsAdvanced，让策略返回 NATIVE_WEBAUDIO 而不是 NATIVE_LITE
		const needsCorsDetection = state.userHasInteracted && internalState.corsStatus === 'PENDING';

		const context: PolicyContext = {
			urlInfo,
			enabled: state.config.enabled,
			volume: state.config.volume,
			// 如果需要 CORS 检测，临时开启"需要高级处理"标志
			visualizerEnabled: settings.visualizerEnabled || needsCorsDetection,
			userInteracted: state.userHasInteracted,
			forceNative: false,
			isRestricted,
			hasMediaElement: true,
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

		// 模式变更处理
		if (desiredMode !== state.activeMode) {
			// 策略调试日志 (仅在模式变更时输出)
			log.debug('[SPECTRA] 策略计算:', {
				url: urlInfo.domain + urlInfo.pathname,
				volume: state.config.volume,
				isRestricted,
				visualizerEnabled: settings.visualizerEnabled,
				决策结果: desiredMode
			});

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

	// 初始化原生音量跟随回调 (网站音量优先)
	// 传递 updateBadge 和 broadcastUI 闭包，已绑定 deps/state/internalState
	initModeExecutorCallbacks(
		deps,
		state,
		() => updateBadge(deps, state, internalState),
		() => broadcastUI(deps, state, internalState)
	);

	// CORS 预检测：发现音频时立即检测，结果缓存到注册表
	probeCorsOnMediaDetected(deps.messenger, internalState, applyState);

	// 页面加载时主动探测：如果 CORS 是 PENDING，等待媒体元素出现后启动检测
	if (internalState.corsStatus === 'PENDING') {
		const tryStartCorsDetection = (attempt: number, maxAttempts: number) => {
			const mediaCount = document.querySelectorAll('video, audio').length;

			if (mediaCount > 0) {
				log.info(`[CORS] 发现 ${mediaCount} 个媒体元素，启动检测...`);
				audioController.initialize().then(() => {
					audioController.scanAndAttach();
				});
			} else if (attempt < maxAttempts) {
				// 延迟后重试
				setTimeout(() => tryStartCorsDetection(attempt + 1, maxAttempts), 1000);
			} else {
				log.info('[CORS] 未发现媒体元素，等待 DOM 变化触发');
			}
		};

		// 首次延迟 500ms 后开始检查，最多检查 5 次
		setTimeout(() => tryStartCorsDetection(1, 5), 500);
	}

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
