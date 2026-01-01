// goal: Search utility functions with Multi-language & Pinyin support
// eff: Supports Name, Description, ID, Keywords, and Chinese Pinyin (Full/Initial)

import type { ToolMeta } from '../kernel';
import { en } from '../i18n/locales/en';
import { zh } from '../i18n/locales/zh';
import { pinyin } from 'pinyin-pro';

export function normalizeSearch(str: string): string {
	if (!str) return '';
	return str.toLowerCase().replace(/\s+/g, '').trim();
}

/**
 * Advanced tool matching logic
 * @param tool The tool to check
 * @param query The search string
 * @param t Current translation function (for dynamic context)
 */
export function matchTool(tool: ToolMeta, query: string, _t: (k: string) => string): boolean {
	if (!query) return false;
	const q = normalizeSearch(query);

	// 1. ID Match (Highest priority)
	if (tool.id.includes(q)) return true;

	// 2. Aggregate searchable texts from all languages
	const searchableTexts: string[] = [];

	// Get EN content
	const enTool = (en as any).tools?.[tool.id];
	if (enTool) {
		searchableTexts.push(enTool.name);
		searchableTexts.push(enTool.desc);
	}

	// Get ZH content
	const zhTool = (zh as any).tools?.[tool.id];
	if (zhTool) {
		searchableTexts.push(zhTool.name);
		searchableTexts.push(zhTool.desc);

		// 3. Pinyin Match (Only if there's Chinese content)
		const zhName = zhTool.name;
		if (/[\u4e00-\u9fa5]/.test(zhName)) {
			// Full Pinyin (e.g., "erweima")
			const fullPinyin = pinyin(zhName, { toneType: 'none', type: 'array' }).join('');
			searchableTexts.push(fullPinyin);

			// Initial Pinyin (e.g., "ewm")
			const initialPinyin = pinyin(zhName, { pattern: 'initial', toneType: 'none', type: 'array' }).join('');
			searchableTexts.push(initialPinyin);
		}
	}

	// 4. Keywords match
	tool.keywords.forEach((kw: string) => searchableTexts.push(kw));

	// Perform normalization and matching on all collected texts
	return searchableTexts.some(text =>
		text && normalizeSearch(text).includes(q)
	);
}
