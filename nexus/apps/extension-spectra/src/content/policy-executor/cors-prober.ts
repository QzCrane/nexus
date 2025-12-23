/**
 * 策略执行器 - CORS 状态管理 (v3.6)
 * 
 * 重要：createMediaElementSource() 会永久劫持元素音频！
 * 不能用于探测，否则会导致视频静音。
 * 
 * v3.6 方案：
 * - 不主动探测，完全依赖 WebAudioController.attachNode() 的回调
 * - 成功回调 → SAFE
 * - 失败回调 → RESTRICTED
 * - 未触发回调 → 保持 PENDING，等待用户交互后再启动
 */

import { logger } from '../../shared/logger';

const log = logger.content;

/** 已确认 CORS 状态的域名 */
const confirmedDomains = new Map<string, boolean>(); // true = RESTRICTED

/**
 * 检查域名是否已确认 CORS 状态
 */
export function isDomainProbed(hostname: string): boolean {
	return confirmedDomains.has(hostname);
}

/**
 * 获取已确认的 CORS 状态
 * @returns true = RESTRICTED, false = SAFE, undefined = 未确认
 */
export function getConfirmedCorsStatus(hostname: string): boolean | undefined {
	return confirmedDomains.get(hostname);
}

/**
 * 标记域名 CORS 状态（由 WebAudioController 回调触发）
 */
export function markDomainCorsStatus(hostname: string, restricted: boolean): void {
	if (confirmedDomains.has(hostname)) {
		log.debug(`[CORS Status] ${hostname}: 已标记过，跳过`);
		return;
	}
	confirmedDomains.set(hostname, restricted);
	log.info(`[CORS Status] ${hostname}: 确认为 ${restricted ? 'RESTRICTED' : 'SAFE'}`);
}

/**
 * 占位函数 - 不执行任何探测
 * 
 * 探测完全依赖 WebAudioController.attachNode() 的成功/失败回调
 * 这个函数只是为了保持接口兼容
 * 
 * @returns 始终返回 null（需要等待回调）
 */
export async function probeWithTempContext(_el: HTMLMediaElement): Promise<boolean | null> {
	// 不执行任何探测！createMediaElementSource 会导致元素静音
	// CORS 状态完全依赖 WebAudioController 的回调
	return null;
}




