/**
 * NEXUS Kernel - 受限域名注册表存储
 * 
 * 纯 CORS 检测驱动：用户编辑 + CORS 自动检测（无默认列表）
 */

import type { DomainEntry, DomainSource, RegistryResult } from '@nexus/contracts';

const KEY = 'restrictedRegistry';

/** 迁移旧格式数据 (string[] → DomainEntry[]) */
function migrateOldFormat(rawData: unknown): DomainEntry[] {
	if (!rawData) return [];
	// 已是新格式
	if (Array.isArray(rawData) && rawData.length > 0 && typeof rawData[0] === 'object') {
		return rawData as DomainEntry[];
	}
	// 旧格式: string[]
	if (Array.isArray(rawData) && rawData.every(d => typeof d === 'string')) {
		const now = Date.now();
		return (rawData as string[]).map((domain, i) => ({
			domain, source: 'user' as DomainSource, probed: false, addedAt: now - i,
		}));
	}
	return [];
}

/** 初始化注册表 (首次安装返回空表，依赖 CORS 检测自动填充) */
export async function initRegistry(): Promise<DomainEntry[]> {
	const result = await chrome.storage.local.get([KEY, 'userRegistry']);
	const rawData = result[KEY] || result['userRegistry'];

	if (rawData) {
		const entries = migrateOldFormat(rawData);
		await chrome.storage.local.set({ [KEY]: entries });
		return entries;
	}

	// 全新安装：空表，完全依赖 CORS 预检测
	await chrome.storage.local.set({ [KEY]: [] });
	return [];
}

/** 获取完整注册表 */
export async function getRegistry(): Promise<DomainEntry[]> {
	const result = await chrome.storage.local.get(KEY);
	return result[KEY] ? migrateOldFormat(result[KEY]) : initRegistry();
}

/** 检查域名是否为受限站点 */
export async function isRestricted(domain: string): Promise<boolean> {
	const entries = await getRegistry();
	return entries.some(e => domain.includes(e.domain) || e.domain.includes(domain));
}

/** 查询域名的检测状态 (null=未在表中) */
export async function queryDomain(domain: string): Promise<DomainEntry | null> {
	const entries = await getRegistry();
	return entries.find(e => e.domain === domain || domain.includes(e.domain)) ?? null;
}

/** 添加域名到注册表 */
export async function addDomain(
	domain: string, source: DomainSource, restricted: boolean = true
): Promise<RegistryResult> {
	const entries = await getRegistry();
	const existing = entries.find(e => e.domain === domain || domain.includes(e.domain));

	if (existing) {
		existing.probed = true;
		existing.restricted = restricted;
		await chrome.storage.local.set({ [KEY]: entries });
		return { success: true, reason: 'updated', entry: existing };
	}

	const entry: DomainEntry = {
		domain, source, probed: true, restricted, addedAt: Date.now(),
	};
	entries.push(entry);
	await chrome.storage.local.set({ [KEY]: entries });
	return { success: true, entry };
}

/** 移除域名 */
export async function removeDomain(domain: string): Promise<RegistryResult> {
	const entries = await getRegistry();
	const filtered = entries.filter(e => e.domain !== domain);
	if (filtered.length === entries.length) return { success: false, reason: 'not_found' };
	await chrome.storage.local.set({ [KEY]: filtered });
	return { success: true };
}

/** 标记域名已预检测 */
export async function markProbed(domain: string, restricted: boolean): Promise<RegistryResult> {
	const entries = await getRegistry();
	const existing = entries.find(e => domain.includes(e.domain));

	if (existing) {
		existing.probed = true;
		existing.restricted = restricted;
		await chrome.storage.local.set({ [KEY]: entries });
		return { success: true, entry: existing };
	}

	// 不在表中: 受限站点入表，安全站点跳过
	return restricted ? addDomain(domain, 'auto', true) : { success: true };
}

/** 获取纯域名列表 (兼容旧接口) */
export async function getDomainList(): Promise<string[]> {
	return (await getRegistry()).map(e => e.domain);
}

/** 设置完整注册表 (用户编辑时调用) */
export async function setRegistry(domains: string[]): Promise<void> {
	const now = Date.now();
	const entries: DomainEntry[] = domains.map((domain, i) => ({
		domain, source: 'user' as DomainSource, probed: false, addedAt: now - i,
	}));
	await chrome.storage.local.set({ [KEY]: entries });
}
