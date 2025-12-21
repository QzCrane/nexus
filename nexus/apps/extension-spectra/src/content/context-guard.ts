/**
 * SPECTRA Content Script - 扩展健康检查
 * 
 * 负责检测扩展上下文是否仍然有效，防止重新加载后的旧脚本报错
 */

import { logger } from '../shared/logger';

const log = logger.content;

/**
 * 检查扩展上下文是否仍然有效
 * 当扩展被重新加载后，旧的 content script 仍在运行但 chrome.runtime 会失效
 */
export function isExtensionContextValid(): boolean {
	try {
		// 尝试访问 chrome.runtime.id，如果上下文已失效会抛出异常
		return !!chrome.runtime?.id;
	} catch {
		return false;
	}
}

/**
 * 安全发送消息 - 在发送前检查上下文有效性
 * 如果上下文已失效，静默返回而不抛出错误
 */
export async function safeSend<T>(
	sendFn: () => Promise<T>,
	fallback?: T
): Promise<T | undefined> {
	if (!isExtensionContextValid()) {
		log.debug('Extension context invalidated, skipping message.');
		return fallback;
	}
	try {
		return await sendFn();
	} catch (e) {
		// 检查是否是上下文失效错误
		if (String(e).includes('Extension context invalidated') ||
			String(e).includes('message port closed')) {
			log.debug('Extension context invalidated during send.');
			return fallback;
		}
		throw e;
	}
}
