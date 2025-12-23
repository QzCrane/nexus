/**
 * 策略执行器 - CORS 检测处理 (v3.6)
 * 
 * 职责：
 * - 初始化时查表获取 CORS 状态
 * - 设置 WebAudioController 回调，绑定成功/失败时更新注册表
 * - 同步已检测的 CORS 状态到本地
 * 
 * 重要：不主动探测！createMediaElementSource 会导致静音
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
		// 成功回调: 证明站点支持 WebAudio（只有 PENDING 时才更新）
		(hostname) => {
			// 只有在 PENDING 状态才更新为 SAFE
			// 如果已经是 RESTRICTED 或 SAFE，不再改变状态
			if (internalState.corsStatus !== 'PENDING') return;

			log.info(`[CORS] Decision: SAFE for ${hostname}`);
			internalState.corsStatus = 'SAFE';

			const settings = settingsManager.get();
			// 标记已检测为安全并添加到安全列表
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.then((response) => {
					if (response?.success && response.reason !== 'updated') {
						const lang = settings.lang || 'en-US';
						const message = lang.startsWith('zh')
							? `✓ 已添加 ${hostname} 到安全列表`
							: `✓ Added ${hostname} to safe list`;
						showToast(message);
					}
				})
				.catch(() => { });

			onStatusChange();
		}
	);
}

/**
 * CORS 状态同步（发现音频时调用）
 * 
 * v3.6 改进：不主动探测！createMediaElementSource 会导致静音
 * CORS 状态完全依赖 WebAudioController.attachNode() 的回调
 * 
 * 流程：
 * 1. 查表：已检测过 → 同步本地状态
 * 2. 检查已绑定元素 → SAFE
 * 3. 未知 → 保持 PENDING，等待 WebAudioController 回调
 */
export async function probeCorsOnMediaDetected(
	messenger: Pick<PolicyExecutorDeps['messenger'], 'send'>,
	internalState?: InternalState,
	onStatusChange?: () => void
): Promise<void> {
	const hostname = window.location.hostname;

	// 如果已有确定的状态，不再处理
	if (internalState && internalState.corsStatus !== 'PENDING') {
		return;
	}

	try {
		// 1. 查表：是否已检测过
		const result = await safeSend(() =>
			messenger.send('REGISTRY_QUERY_DOMAIN', { domain: hostname })
		);

		if (result?.entry?.probed) {
			log.debug(`[CORS Sync] ${hostname}: 已检测过 (${result.entry.restricted ? 'RESTRICTED' : 'SAFE'})`);
			if (internalState) {
				internalState.corsStatus = result.entry.restricted ? 'RESTRICTED' : 'SAFE';
				onStatusChange?.();
			}
			return;
		}

		// 2. 检查页面元素是否已被 WebAudioController 绑定
		const attachedEl = document.querySelector('video[data-vm-attached="true"], audio[data-vm-attached="true"]');
		if (attachedEl) {
			log.debug(`[CORS Sync] ${hostname}: SAFE (发现已绑定元素)`);
			if (internalState) internalState.corsStatus = 'SAFE';
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.catch(() => { });
			onStatusChange?.();
			return;
		}

		// 3. 未知域名：保持 PENDING，等待 WebAudioController 的回调
		// 不主动探测！WebAudioController.attachNode() 会触发成功/失败回调
		log.debug(`[CORS Sync] ${hostname}: 未知，等待 WebAudioController 回调`);

	} catch (err) {
		log.debug(`[CORS Sync] 查询失败: ${err}`);
	}
}


