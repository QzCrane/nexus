/**
 * SPECTRA Popup - 注册表辅助函数
 */

import type { DomainEntry, DomainSource } from '@nexus/contracts';

/** 来源标记映射 (纯文本，不使用 emoji) */
const SOURCE_LABELS: Record<DomainSource, string> = {
	user: '',    // 用户添加
	auto: '',    // 自动检测
};

/** 迁移旧格式数据 (string[] → DomainEntry[]) */
export function migrateRegistry(rawData: unknown): DomainEntry[] {
	if (!rawData) return [];
	// 已是新格式
	if (Array.isArray(rawData) && rawData.length > 0 && typeof rawData[0] === 'object') {
		return rawData as DomainEntry[];
	}
	// 旧格式: string[]
	if (Array.isArray(rawData) && rawData.every(d => typeof d === 'string')) {
		return (rawData as string[]).map((domain, i) => ({
			domain, source: 'user' as DomainSource, probed: false, addedAt: Date.now() - i,
		}));
	}
	return [];
}

/** 格式化条目用于显示 */
export function formatEntry(e: DomainEntry): string {
	return `${SOURCE_LABELS[e.source] || ''} ${e.domain}`.trim();
}

/** 解析用户输入的行 */
export function parseEntry(line: string): DomainEntry {
	// 去掉可能的来源标记
	const cleaned = line.replace(/^[📋✏️🔍]\s*/, '').trim();
	return { domain: cleaned, source: 'user', probed: false, addedAt: Date.now() };
}
