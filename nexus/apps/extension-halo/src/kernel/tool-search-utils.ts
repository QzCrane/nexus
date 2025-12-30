// goal: Tool Search Utilities
// eff: Extracted from use-tool-manager.ts

import type { ToolMeta } from './tool-registry-types';

// Pinyin-like search (simplified - matches first char of Chinese)
export function normalizeSearch(str: string): string {
	return str.toLowerCase().replace(/\s+/g, '');
}

export function matchesSearch(tool: ToolMeta, query: string): boolean {
	if (!query) return true;
	const q = normalizeSearch(query);
	// Match ID
	if (tool.id.includes(q)) return true;
	// Match keywords
	return tool.keywords.some((kw) => normalizeSearch(kw).includes(q));
}
