/**
 * 策略执行器 - CORS 检测处理 (v3.2)
 * 
 * 职责：
 * - 初始化时查表获取 CORS 状态
 * - 设置 WebAudioController 回调，绑定成功/失败时更新注册表
 * - probeCorsOnMediaDetected 仅做快速检查，不执行破坏性探测
 * 
 * 设计原则：
 * - 完全依赖 WebAudioController 实际绑定结果
 * - 不创建独立 AudioContext 探测（避免破坏媒体元素）
 * - 检测结果持久化到 restrictedRegistry
 */

import { safeSend } from '../context-guard';
import { showToast } from '../toast';
import { logger } from '../../shared/logger';
import type { PolicyExecutorDeps } from '../types';
import type { InternalState, CorsStatus } from './types';

const log = logger.content;

/**
 * 初始化 CORS 状态（从注册表读取）
 * 
 * @returns 初始 corsStatus
 */
export async function initCorsStatus(
	messenger: Pick<PolicyExecutorDeps['messenger'], 'send'>
): Promise<CorsStatus> {
	const hostname = window.location.hostname;

	try {
		// 查询注册表
		const result = await safeSend(() =>
			messenger.send('REGISTRY_QUERY_DOMAIN', { domain: hostname })
		);

		if (result?.entry) {
			// 已在表中
			if (result.entry.probed) {
				// 已预检测过，直接使用结果
				return result.entry.restricted ? 'RESTRICTED' : 'SAFE';
			}
			// 在表中但未检测，视为受限（保守策略）
			return 'RESTRICTED';
		}

		// 不在表中，待检测
		return 'PENDING';
	} catch {
		// 查询失败，待检测
		return 'PENDING';
	}
}

/**
 * 设置 CORS 检测回调（策略切换时触发）
 */
export function setupCorsCallback(
	deps: PolicyExecutorDeps,
	internalState: InternalState,
	onStatusChange: () => void
): void {
	const { messenger, audioController, settingsManager } = deps;

	audioController.setCallbacks(
		// 失败回调: 发现跨域限制 (立即判定，成功回调可覆盖)
		(hostname) => {
			if (internalState.corsStatus !== 'PENDING') return;

			log.info(`[CORS] Decision: RESTRICTED for ${hostname}`);
			internalState.corsStatus = 'RESTRICTED';

			const settings = settingsManager.get();
			// 标记已检测并添加到注册表
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: true }))
				.then((response) => {
					if (response?.success && response.reason !== 'updated') {
						const lang = settings.lang || 'en-US';
						const message = lang.startsWith('zh')
							? `🔧 已添加 ${hostname} 到劫持列表`
							: `🔧 Added ${hostname} to capture list`;
						showToast(message);
					}
				})
				.catch(() => { });

			onStatusChange();
		},
		// 成功回调: 证明站点支持 WebAudio
		(hostname) => {
			if (internalState.corsStatus === 'SAFE') return;

			log.info(`[CORS] Decision: SAFE for ${hostname}`);
			internalState.corsStatus = 'SAFE';

			// 标记已检测为安全
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.catch(() => { });

			onStatusChange();
		}
	);
}

/**
 * CORS 预检测（发现音频时调用）
 * 
 * v3.2 改进：不再创建独立 AudioContext 探测，避免破坏媒体元素绑定
 * 依赖 WebAudioController.setCallbacks() 的成功/失败回调来更新注册表
 * 
 * 此函数仅做快速检查：
 * 1. 查表：是否已检测过
 * 2. 检查页面元素是否已被 WebAudioController 绑定（直接判定 SAFE）
 */
export async function probeCorsOnMediaDetected(
	messenger: Pick<PolicyExecutorDeps['messenger'], 'send'>
): Promise<void> {
	const hostname = window.location.hostname;

	try {
		// 1. 查表：是否已检测过
		const result = await safeSend(() =>
			messenger.send('REGISTRY_QUERY_DOMAIN', { domain: hostname })
		);

		if (result?.entry?.probed) {
			log.debug(`[CORS Probe] ${hostname}: 已检测过 (${result.entry.restricted ? 'RESTRICTED' : 'SAFE'})`);
			return;
		}

		// 2. 检查页面元素是否已被 WebAudioController 绑定
		const mediaEl = document.querySelector('video[data-vm-attached="true"], audio[data-vm-attached="true"]');
		if (mediaEl) {
			// 已绑定 = SAFE
			log.debug(`[CORS Probe] ${hostname}: SAFE (发现已绑定的媒体元素)`);
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.catch(() => { });
			return;
		}

		// 3. 未检测过且无绑定元素：等待 WebAudioController 的回调
		// 不主动探测，避免破坏媒体元素
		log.debug(`[CORS Probe] ${hostname}: 等待 WebAudioController 回调判定`);

	} catch (err) {
		log.debug(`[CORS Probe] 查表失败: ${err}`);
		// 失败时也不主动探测，等待回调
	}
}
