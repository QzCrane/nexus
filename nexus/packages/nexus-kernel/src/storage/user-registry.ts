/**
 * NEXUS Kernel - 用户注册表存储
 */

const KEY = 'userRegistry';

/** 获取用户注册表 */
export async function getUserRegistry(): Promise<string[]> {
	const result = await chrome.storage.local.get(KEY);
	return result[KEY] || [];
}

/** 添加域名到注册表 */
export async function addToUserRegistry(domain: string): Promise<boolean> {
	const registry = await getUserRegistry();
	const exists = registry.some(d => domain.includes(d) || d.includes(domain));
	if (exists) return false;
	registry.push(domain);
	await chrome.storage.local.set({ [KEY]: registry });
	return true;
}

/** 从注册表移除域名 */
export async function removeFromUserRegistry(domain: string): Promise<boolean> {
	const registry = await getUserRegistry();
	const filtered = registry.filter(d => d !== domain);
	if (filtered.length === registry.length) return false;
	await chrome.storage.local.set({ [KEY]: filtered });
	return true;
}

/** 设置完整注册表 */
export async function setUserRegistry(registry: string[]): Promise<void> {
	await chrome.storage.local.set({ [KEY]: registry });
}
