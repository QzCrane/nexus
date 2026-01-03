// goal: Module metadata and registry - consumes generated data
// eff: Uses unified ToolMeta type from tool-registry-types

import type { ToolMeta } from '../core/tool-registry-types';
import { ALL_APPS as GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';

// Module installation status
export type ModuleStatus = 'available' | 'installed' | 'downloading' | 'updating' | 'error';

// Module state (local installation status)
export interface ModuleState {
	id: string;
	status: ModuleStatus;
	installedVersion?: string;
	installedAt?: number;
	lastUsed?: number;
	error?: string;
}

// Module manager state
export interface ModuleManagerState {
	modules: Record<string, ModuleState>;
	downloading: string[];
	lastSync: number;
}

// Build ToolMeta from GeneratedToolMeta
function buildToolMeta(tool: GeneratedToolMeta): ToolMeta {
	return {
		id: tool.id,
		icon: tool.icon,
		category: tool.category,
		status: tool.builtIn ? 'ready' : 'available',
		keywords: tool.keywords || [],
		features: tool.features,
		system: tool.system,
		permissions: tool.permissions,
		// SaaT fields
		toolType: tool.toolType,
		scriptMatches: tool.scriptMatches,
		scriptExcludeMatches: tool.scriptExcludeMatches,
		scriptRunAt: tool.scriptRunAt,
		scriptType: tool.scriptType,
		// Module-specific fields
		size: tool.size,
		builtIn: tool.builtIn,
		dependencies: tool.dependencies,
		version: '1.0.0',
	};
}

// Core modules (builtIn: true)
export const CORE_MODULES: ToolMeta[] = GENERATED_TOOLS
	.filter(t => t.builtIn)
	.map(buildToolMeta);

// Optional modules (builtIn: false)
export const OPTIONAL_MODULES: ToolMeta[] = GENERATED_TOOLS
	.filter(t => !t.builtIn)
	.map(buildToolMeta);

// All modules combined
export const ALL_MODULES: ToolMeta[] = GENERATED_TOOLS.map(buildToolMeta);

// Get module by ID
export const getModuleMeta = (id: string): ToolMeta | undefined =>
	ALL_MODULES.find(m => m.id === id);

// Format size for display
export const formatModuleSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};

// Re-export for backward compatibility
export { ALL_APPS as GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';

