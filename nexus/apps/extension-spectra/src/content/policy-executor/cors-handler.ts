/**
 * 策略执行器 - CORS 检测处理
 * 
 * 职责：
 * - 设置 CORS 检测回调
 * - 实现"主权判定"逻辑：一旦成功连接 WebAudio 就标记为 SAFE
 * - 自动添加/移除受限域名注册表
 */

import { safeSend } from '../context-guard';
import { showToast } from '../toast';
import { logger } from '../../shared/logger';
import type { PolicyExecutorDeps } from '../types';
import type { InternalState } from './types';

const log = logger.content;

/**
 * 设置 CORS 检测回调
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

			// 延迟判定，给成功的视频留反应时间（防止广告误报）
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

			// 自愈：若曾被错误加入受限列表，则移除
			safeSend(() => messenger.send('REGISTRY_REMOVE_DOMAIN', { domain: hostname })).catch(() => { });

			onStatusChange();
		}
	);
}
