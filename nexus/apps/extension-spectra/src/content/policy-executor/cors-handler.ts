/**
 * 策略执行器 - CORS 检测处理
 * 
 * 职责：
 * - 设置 CORS 检测回调
 * - 实现"主权判定"逻辑：一旦成功连接 WebAudio 就标记为 SAFE
 * - 自动添加/移除受限域名注册表
 * 
 * 核心逻辑：
 * - 进网站后开始主权判定
 * - 只要有一个媒体元素成功连接 WebAudio，站点即被永久标记为 SAFE
 * - 屏蔽所有后续报错（忽略广告干扰）
 */

import { DefaultSiteRules } from '@nexus/audio-engine';
import { safeSend } from '../context-guard';
import { showToast } from '../toast';
import { logger } from '../../shared/logger';
import type { PolicyExecutorDeps } from '../types';
import type { InternalState } from './types';

const log = logger.content;

/**
 * 设置 CORS 检测回调
 * 
 * @param deps 依赖对象
 * @param internalState 内部状态（corsStatus）
 * @param onStatusChange 状态变化时的回调（触发 applyState）
 */
export function setupCorsCallback(
	deps: PolicyExecutorDeps,
	internalState: InternalState,
	onStatusChange: () => void
): void {
	const { messenger, audioController, settingsManager } = deps;

	audioController.setCallbacks(
		// 失败回调: 发现跨域限制
		(hostname) => {
			if (internalState.corsStatus !== 'PENDING') return;

			// 延迟 1.5 秒判定，给"成功的视频"留出反应时间 (防止 Ad 先报错)
			setTimeout(() => {
				if (internalState.corsStatus !== 'PENDING') return;

				log.info(`[CORS] Decision: RESTRICTED for ${hostname}`);
				internalState.corsStatus = 'RESTRICTED';

				const settings = settingsManager.get();
				safeSend(() => messenger.send('REGISTRY_ADD_DOMAIN', { domain: hostname }))
					.then((response) => {
						if (response?.success) {
							const lang = settings.lang || 'en-US';
							const message = lang.startsWith('zh')
								? `🔧 已自动添加 ${hostname} 到劫持列表`
								: `🔧 Auto-added ${hostname} to capture list`;
							showToast(message);
						}
					})
					.catch(() => { });

				onStatusChange();
			}, 1500);
		},
		// 成功回调: 证明站点支持 WebAudio
		(hostname) => {
			if (internalState.corsStatus === 'SAFE') return;

			log.info(`[CORS] Decision: SAFE for ${hostname}`);
			internalState.corsStatus = 'SAFE';

			// 自愈逻辑: 如果该站点是已知可以原生支持的 (如 B站)，
			// 但由于某种原因它在受限注册表里，则将其移除，彻底根治"变紫"
			const isWellKnownSite = DefaultSiteRules.some(rule => hostname.includes(rule.hostPattern));
			if (isWellKnownSite) {
				log.info(`[CORS] Healing well-known site: ${hostname}`);
				safeSend(() => messenger.send('REGISTRY_REMOVE_DOMAIN', { domain: hostname })).catch(() => { });
			}

			// 一旦判定为安全，立即刷新一次状态，确保变蓝
			onStatusChange();
		}
	);
}
