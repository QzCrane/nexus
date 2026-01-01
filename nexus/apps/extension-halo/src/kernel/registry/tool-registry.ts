// goal: Centralized tool registry system
// eff: Static registry of defaults, logic separated from data

import type { ToolCategory } from '../../i18n/types';
import type { ToolMeta, ToolPrefs } from '../core/tool-registry-types';
import { ALL_MODULES } from './module-registry';
// Map ALL_MODULES to ToolMeta format (they are compatible)
export const TOOL_REGISTRY: ToolMeta[] = ALL_MODULES.map(m => ({
	id: m.id as any, // Cast to ensure compatibility if ToolId is strict
	name: m.name,
	description: m.description,
	category: m.category,
	icon: m.icon,
	status: m.builtIn ? 'ready' : 'available', // Default status, overridden by module manager
	keywords: [],
	system: m.system,
}));

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
