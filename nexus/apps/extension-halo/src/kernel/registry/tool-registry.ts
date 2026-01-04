// goal: Centralized tool registry system
// eff: SSOT from PLUGIN_REGISTRY

import type { ToolCategory } from '../../i18n/types';
import type { PluginMeta, ToolPrefs } from '../core/tool-registry-types';
import { ALL_MODULES } from './module-registry';
import { getToolPlugins, getScriptPlugins, getSystemPlugins } from './_generated';

// TOOL_REGISTRY is ALL_MODULES (unified)
export const TOOL_REGISTRY: PluginMeta[] = ALL_MODULES;

// Runtime filters (re-export from _generated)
export { getToolPlugins, getScriptPlugins, getSystemPlugins };

// Helper: check if plugin is system
export const isSystemPlugin = (id: string): boolean =>
	TOOL_REGISTRY.some(p => p.id === id && p.pluginType === 'system');

// Helper: check if plugin is script
export const isScriptPlugin = (id: string): boolean =>
	TOOL_REGISTRY.some(p => p.id === id && p.pluginType === 'script');

export * from '../core/tool-registry-types';

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
	enabled: true,
	pinned: false,
	usageCount: 0,
};

export const TOOL_PREFS_KEY = 'halo_tool_prefs';

// Get tool by ID
export function getToolMeta(id: string): PluginMeta | undefined {
	return TOOL_REGISTRY.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.category === category);
}

// Get ready tools only (status check)
export function getReadyTools(): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.status === 'ready' || t.status === 'beta');
}

// Legacy alias
export type ToolMeta = PluginMeta;
