// goal: Search utility functions for the SearchBar component
// eff: Extracted from SearchBar.tsx to reduce file size

import type { ToolMeta } from '../kernel/tool-registry';

export function normalizeSearch(str: string): string {
	return str.toLowerCase().replace(/\s+/g, '');
}

export function matchTool(tool: ToolMeta, query: string, t: (k: string) => string): boolean {
	if (!query) return false;
	const q = normalizeSearch(query);
	// ID match
	if (tool.id.includes(q)) return true;
	// Keywords match
	if (tool.keywords.some((kw) => normalizeSearch(kw).includes(q))) return true;
	// Translated name match
	const name = normalizeSearch(t(`tools.${tool.id}.name`));
	return name.includes(q);
}
