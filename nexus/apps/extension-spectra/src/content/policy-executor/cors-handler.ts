/**
 * 策略执行器 - CORS 检测处理 (v3.3)
 * 
 * 职责：
 * - 初始化时查表获取 CORS 状态
 * - 设置 WebAudioController 回调，绑定成功/失败时更新注册表
 * - 主动探测未知域名的 CORS 状态
 */


import { safeSend } from '../context-guard';
import { showToast } from '../toast';
import { logger } from '../../shared/logger';
import { probeWithTempContext } from './cors-prober';
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

			// 标记已检测为安全
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.catch(() => { });

			onStatusChange();
		}
	);
}

/**
 * CORS 主动探测（发现音频时调用）
 * 
 * v3.3 改进：主动探测未知域名，使用临时 AudioContext 测试
 * 
 * 流程：
 * 1. 查表：已检测过 → 直接返回
 * 2. 检查已绑定元素 → SAFE
 * 3. 未知域名 → 主动探测（临时 AudioContext）
 */
export async function probeCorsOnMediaDetected(
	messenger: Pick<PolicyExecutorDeps['messenger'], 'send'>,
	internalState?: InternalState,
	onStatusChange?: () => void
): Promise<void> {
	const hostname = window.location.hostname;

	try {
		// 1. 查表：是否已检测过
		const result = await safeSend(() =>
			messenger.send('REGISTRY_QUERY_DOMAIN', { domain: hostname })
		);

		if (result?.entry?.probed) {
			log.debug(`[CORS Probe] ${hostname}: 已检测过 (${result.entry.restricted ? 'RESTRICTED' : 'SAFE'})`);
			// 如果本地状态还是 PENDING，同步更新
			if (internalState && internalState.corsStatus === 'PENDING') {
				internalState.corsStatus = result.entry.restricted ? 'RESTRICTED' : 'SAFE';
				onStatusChange?.();
			}
			return;
		}

		// 2. 检查页面元素是否已被 WebAudioController 绑定
		const attachedEl = document.querySelector('video[data-vm-attached="true"], audio[data-vm-attached="true"]');
		if (attachedEl) {
			log.debug(`[CORS Probe] ${hostname}: SAFE (发现已绑定元素)`);
			if (internalState) internalState.corsStatus = 'SAFE';
			safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: false }))
				.catch(() => { });
			onStatusChange?.();
			return;
		}

		// 3. 主动探测：找一个未绑定的媒体元素进行测试
		const testEl = document.querySelector('video:not([data-vm-attached]), audio:not([data-vm-attached])') as HTMLMediaElement | null;
		if (!testEl) {
			log.debug(`[CORS Probe] ${hostname}: 无可用媒体元素，等待后续检测`);
			return;
		}

		// 执行主动探测
		const probeResult = await probeWithTempContext(testEl);

		// null = 元素未就绪或已探测过
		if (probeResult === null) {
			log.debug(`[CORS Probe] ${hostname}: 跳过 (未就绪或已探测)`);
			return;
		}

		log.info(`[CORS Probe] ${hostname}: 主动探测结果 = ${probeResult ? 'RESTRICTED' : 'SAFE'}`);

		// 更新本地状态
		if (internalState) {
			internalState.corsStatus = probeResult ? 'RESTRICTED' : 'SAFE';
		}

		// 记录到注册表
		safeSend(() => messenger.send('REGISTRY_MARK_PROBED', { domain: hostname, restricted: probeResult }))
			.then((response) => {
				if (response?.success && probeResult && response.reason !== 'updated') {
					showToast(`🔧 检测到 ${hostname} 需要劫持模式`);
				}
			})
			.catch(() => { });

		// 触发策略重新计算
		onStatusChange?.();

	} catch (err) {
		log.debug(`[CORS Probe] 探测失败: ${err}`);
	}
}

