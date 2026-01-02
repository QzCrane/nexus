// goal: Search utilities - delegates to unified search engine
// eff: Backward-compatible re-export layer

import type { ToolMeta } from '../kernel';
import { matchItem, normalizeSearch, TOOL_SEARCH_OPTIONS } from '../kernel/utils/unified-search';

// Re-export for backward compatibility
export { normalizeSearch };

/**
 * Tool matching - delegates to unified search engine
 * @deprecated Use matchItem from unified-search.ts directly
 */
export function matchTool(tool: ToolMeta, query: string, _t: (k: string) => string): boolean {
	return matchItem(tool, query, TOOL_SEARCH_OPTIONS);
}
