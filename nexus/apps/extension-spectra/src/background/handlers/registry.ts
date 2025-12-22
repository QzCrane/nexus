/**
 * SPECTRA Background - 域名注册表处理器
 * 
 * 处理强制劫持域名列表相关的消息
 * 三合一管理：默认列表 + 用户编辑 + CORS 自动检测
 */

import { router, storage } from '../state';

/**
 * 注册域名注册表相关的消息处理器
 */
export function registerRegistryHandlers(): void {
	// 添加域名到用户注册表 (旧接口兼容)
	router.on('REGISTRY_ADD_DOMAIN', async (req) => {
		const result = await storage.registry.add(req.domain, 'auto', true);
		return { success: result.success, reason: result.reason };
	});

	// 从用户注册表移除域名
	router.on('REGISTRY_REMOVE_DOMAIN', async (req) => {
		const result = await storage.registry.remove(req.domain);
		return { success: result.success };
	});

	// 查询域名状态 (新接口)
	router.on('REGISTRY_QUERY_DOMAIN', async (req) => {
		const entry = await storage.registry.query(req.domain);
		return { entry };
	});

	// 标记域名已预检测 (新接口)
	router.on('REGISTRY_MARK_PROBED', async (req) => {
		const result = await storage.registry.markProbed(req.domain, req.restricted);
		return { success: result.success, reason: result.reason };
	});
}

