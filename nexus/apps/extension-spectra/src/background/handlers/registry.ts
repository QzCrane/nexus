/**
 * SPECTRA Background - 域名注册表处理器
 * 
 * 处理强制劫持域名列表相关的消息
 */

import { router, storage } from '../state';

/**
 * 注册域名注册表相关的消息处理器
 */
export function registerRegistryHandlers(): void {
	// 添加域名到用户注册表
	router.on('REGISTRY_ADD_DOMAIN', async (req) => {
		const success = await storage.addToUserRegistry(req.domain);
		return { success, reason: success ? undefined : 'Already exists' };
	});

	// 从用户注册表移除域名
	router.on('REGISTRY_REMOVE_DOMAIN', async (req) => {
		const success = await storage.removeFromUserRegistry(req.domain);
		return { success: !!success };
	});
}
