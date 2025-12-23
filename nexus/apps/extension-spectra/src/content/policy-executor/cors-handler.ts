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
import { findProbeCandidate } from './media-probe';

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
		// 失败回调: 发现跨域限制（仅 PENDING 时生效）
		(hostname) => {
			// 只有 PENDING 时才能判定 RESTRICTED
			// 如果已经是 SAFE，不允许回退
			if (internalState.corsStatus !== 'PENDING') return;

			log.info(`[CORS] Decision: RESTRICTED for ${hostname}`);
			internalState.corsStatus = 'RESTRICTED';

			const settings = settingsManager.get();
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: true }))
				.then((response) => {
					// 始终显示 Toast，让用户知道检测结果
					if (response?.success) {
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
		// 成功回调: 检测到音频数据 = 一定是 SAFE（可覆盖 RESTRICTED）
		(hostname) => {
			// 已经是 SAFE 则跳过
			if (internalState.corsStatus === 'SAFE') return;

			// 检测到数据就是 SAFE，可以覆盖之前的 RESTRICTED 误判
			const wasRestricted = internalState.corsStatus === 'RESTRICTED';
			if (wasRestricted) {
				log.info(`[CORS] Correcting: ${hostname} RESTRICTED -> SAFE`);
			} else {
				log.info(`[CORS] Decision: SAFE for ${hostname}`);
			}
			internalState.corsStatus = 'SAFE';

			const settings = settingsManager.get();
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.then((response) => {
					// 无论是新增还是更正，都显示 Toast
					const lang = settings.lang || 'en-US';
					const message = wasRestricted
						? (lang.startsWith('zh') ? `✓ 已更正 ${hostname} 为安全站点` : `✓ Corrected ${hostname} to safe`)
						: (lang.startsWith('zh') ? `✓ 已添加 ${hostname} 到安全列表` : `✓ Added ${hostname} to safe list`);
					if (response?.success) showToast(message);
				})
				.catch(() => { });

			onStatusChange();
		}
	);
}

/**
 * CORS 状态同步（发现音频时调用）
 * 
 * v3.9 改进：主动探测正在播放的媒体元素
 * 当发现非静音、正在播放的视频时，主动创建探测节点触发 CORS 检测
 * 
 * 流程：
 * 1. 查表：已检测过 → 同步本地状态
 * 2. 检查已绑定元素 → SAFE
 * 3. 发现正在播放的媒体 → 主动探测
 * 4. 未知 → 保持 PENDING，等待 WebAudioController 回调
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

		// 注意：data-vm-attached 只表示已绑定 AudioContext，不代表 CORS 检测完成
		// createMediaElementSource() 不会因 CORS 抛错，所以绑定成功不等于跨域可用
		// 真正的 CORS 判定由 scheduleCorsCheck 读取 AnalyserNode 数据后决定

		// 3. 发现正在播放的媒体元素 → 主动探测
		// 查找适合探测的元素：非静音、正在播放、有足够时长
		const candidateEl = findProbeCandidate();
		if (candidateEl && !candidateEl.dataset.vmProbed) {
			log.debug(`[CORS Sync] ${hostname}: 发现可探测媒体，主动触发检测`);
			candidateEl.dataset.vmProbed = 'true';
			// 主动探测会创建临时 AudioContext，依赖 WebAudioController 的回调更新状态
			// 此处仅标记，实际探测在 controller.attachNode 中进行
		}

		// 4. 未知域名：保持 PENDING，等待 WebAudioController 的回调
		// 不主动探测！WebAudioController.attachNode() 会触发成功/失败回调
		log.debug(`[CORS Sync] ${hostname}: 未知，等待 WebAudioController 回调`);

	} catch (err) {
		log.debug(`[CORS Sync] 查询失败: ${err}`);
	}
}

