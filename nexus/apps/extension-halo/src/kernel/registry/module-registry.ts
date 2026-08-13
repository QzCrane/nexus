// goal: Module metadata and registry - consumes generated data
// eff: Direct re-export of PLUGIN_REGISTRY with status enrichment

import type { PluginMeta } from '../core/tool-registry-types';
import { PLUGIN_REGISTRY, type PluginMeta as GeneratedPluginMeta } from './_generated';

// Bundled-module enablement status. No packaged bytes are installed or removed.
export type ModuleStatus = 'disabled' | 'enabled' | 'enabling' | 'updating' | 'error';

// Module state (local installation status)
export interface ModuleState {
	id: string;
	status: ModuleStatus;
	enabledVersion?: string;
	lastUsed?: number;
	error?: string;
}

// Module manager state
export interface ModuleManagerState {
	modules: Record<string, ModuleState>;
	downloading: string[];
	lastSync: number;
}

// Enrich with runtime status
function enrichWithStatus(plugin: GeneratedPluginMeta): PluginMeta {
	return {
		...plugin,
		status: plugin.builtIn ? 'ready' : 'available',
	};
}

// All modules with status
export const ALL_MODULES: PluginMeta[] = PLUGIN_REGISTRY.map(enrichWithStatus);

// Core modules (builtIn: true)
export const CORE_MODULES: PluginMeta[] = ALL_MODULES.filter(m => m.builtIn);

// Optional modules (builtIn: false)
export const OPTIONAL_MODULES: PluginMeta[] = ALL_MODULES.filter(m => !m.builtIn);

// Get module by ID
export const getModuleMeta = (id: string): PluginMeta | undefined =>
	ALL_MODULES.find(m => m.id === id);

// Re-exports for backward compatibility
export { PLUGIN_REGISTRY, type PluginMeta as GeneratedPluginMeta } from './_generated';
/** @deprecated Use PLUGIN_REGISTRY directly */
export { PLUGIN_REGISTRY as GENERATED_TOOLS } from './_generated';
/** @deprecated Use PluginMeta */
export type GeneratedToolMeta = GeneratedPluginMeta;

// Legacy alias
export type ToolMeta = PluginMeta;
