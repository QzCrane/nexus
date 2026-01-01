// goal: Module metadata and registry - consumes generated data
// eff: Types + runtime merge with i18n data

import type { ToolCategory } from '../../i18n/types';
import { GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';

// Module installation status
export type ModuleStatus = 'available' | 'installed' | 'downloading' | 'updating' | 'error';

// Module metadata (full, with i18n fields)
export interface ModuleMeta {
	id: string;
	name: string;
	description: string;
	version: string;
	category: ToolCategory;
	icon: string;
	size: number;
	dependencies?: string[];
	bundleUrl?: string;
	builtIn?: boolean;
}

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

// Build ModuleMeta from GeneratedToolMeta (adds i18n placeholder fields)
// Actual i18n values are resolved at render time via t(`tools.${id}.name`)
function buildModuleMeta(tool: GeneratedToolMeta): ModuleMeta {
	return {
		id: tool.id,
		name: tool.id, // Placeholder - resolved via i18n at runtime
		description: '', // Placeholder - resolved via i18n at runtime
		version: '1.0.0',
		category: tool.category,
		icon: tool.icon,
		size: tool.size,
		builtIn: tool.builtIn,
		dependencies: tool.dependencies,
	};
}

// Core modules (builtIn: true)
export const CORE_MODULES: ModuleMeta[] = GENERATED_TOOLS
	.filter(t => t.builtIn)
	.map(buildModuleMeta);

// Optional modules (builtIn: false)
export const OPTIONAL_MODULES: ModuleMeta[] = GENERATED_TOOLS
	.filter(t => !t.builtIn)
	.map(buildModuleMeta);

// All modules combined
export const ALL_MODULES: ModuleMeta[] = GENERATED_TOOLS.map(buildModuleMeta);

// Get module by ID
export const getModuleMeta = (id: string): ModuleMeta | undefined =>
	ALL_MODULES.find(m => m.id === id);

// Format size for display
export const formatModuleSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};

// Re-export generated types for convenience
export { GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';
