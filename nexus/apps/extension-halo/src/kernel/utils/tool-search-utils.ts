// goal: Tool Search Utilities - delegates to unified search engine
// eff: Backward-compatible wrapper

import type { ToolMeta } from '../core/tool-registry-types';
import { matchItem, TOOL_SEARCH_OPTIONS } from './unified-search';

/**
 * @deprecated Use matchItem from unified-search.ts directly
 */
export function matchesSearch(tool: ToolMeta, query: string): boolean {
	return matchItem(tool, query, TOOL_SEARCH_OPTIONS);
}
