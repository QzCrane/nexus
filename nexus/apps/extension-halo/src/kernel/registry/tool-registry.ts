// goal: Centralized tool registry system
// eff: Uses unified ToolMeta from ALL_MODULES

import type { ToolCategory } from '../../i18n/types';
import type { ToolMeta, ToolPrefs } from '../core/tool-registry-types';
import { ALL_MODULES } from './module-registry';

// TOOL_REGISTRY is now directly ALL_MODULES (types are unified)
export const TOOL_REGISTRY: ToolMeta[] = ALL_MODULES;

export * from '../core/tool-registry-types';

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
	enabled: true,
	pinned: false,
	usageCount: 0,
};

export const TOOL_PREFS_KEY = 'halo_tool_prefs';

// Get tool by ID
export function getToolMeta(id: string): ToolMeta | undefined {
	return TOOL_REGISTRY.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): ToolMeta[] {
	return TOOL_REGISTRY.filter((t) => t.category === category);
}

// Get ready tools only
export function getReadyTools(): ToolMeta[] {
	return TOOL_REGISTRY.filter((t) => t.status === 'ready' || t.status === 'beta');
}
