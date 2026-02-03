// goal: Centralized tool registry system
// tradeoff: Flexibility vs type safety - use metadata for extensibility
// eff: Single source of truth for all tools

import type { ToolCategory } from '../i18n/types';
import type { PluginMeta, ToolPrefs } from './core/tool-registry-types';

// Re-export for compatibility
export type { PluginMeta, ToolPrefs };
export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled';
// Alias for backward compatibility (but prefer PluginMeta)
export type ToolMeta = PluginMeta;


// All registered tools
import { PLUGIN_REGISTRY } from './registry/_generated';

// Use the generated registry as the source of truth
export const TOOL_REGISTRY: PluginMeta[] = PLUGIN_REGISTRY;


// Default preferences for new tools
export const DEFAULT_TOOL_PREFS: ToolPrefs = {
	enabled: true,
	pinned: false,
	usageCount: 0,
};

// Storage key for tool preferences
export const TOOL_PREFS_KEY = 'halo_tool_prefs';

// Get tool by ID
export function getToolMeta(id: string): PluginMeta | undefined {
	return TOOL_REGISTRY.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.category === category);
}

// Get ready tools only
export function getReadyTools(): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.status === 'ready' || t.status === 'beta');
}
