// goal: Module metadata and registry - consumes generated data
// inv: Product release status is immutable metadata; enablement lives in ModuleState.

import type { PluginMeta } from '../core/tool-registry-types';
import { normalizeReleaseStatus } from './release-admission';
import { PLUGIN_REGISTRY, type PluginMeta as GeneratedPluginMeta } from './_generated';

// Bundled-module enablement status. No packaged bytes are installed or removed.
export type ModuleStatus = 'disabled' | 'enabled' | 'enabling' | 'updating' | 'error';

// Module state (local enablement status)
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

function normalizeProductStatus(plugin: GeneratedPluginMeta): PluginMeta {
	return {
		...plugin,
		status: normalizeReleaseStatus(plugin.status),
	};
}

// Product readiness is normalized once from manifest metadata. Never derive it
// from builtIn/optional enablement: a bundled coming module remains coming,
// and an optional ready module remains ready even while locally disabled.
export const ALL_MODULES: PluginMeta[] = PLUGIN_REGISTRY.map(normalizeProductStatus);

// Core modules (builtIn: true)
export const CORE_MODULES: PluginMeta[] = ALL_MODULES.filter((module) => module.builtIn);

// Optional modules (builtIn: false)
export const OPTIONAL_MODULES: PluginMeta[] = ALL_MODULES.filter((module) => !module.builtIn);

// Get module by ID
export const getModuleMeta = (id: string): PluginMeta | undefined =>
	ALL_MODULES.find((module) => module.id === id);

// Re-exports for backward compatibility
export { PLUGIN_REGISTRY, type PluginMeta as GeneratedPluginMeta } from './_generated';
/** @deprecated Use PLUGIN_REGISTRY directly */
export { PLUGIN_REGISTRY as GENERATED_TOOLS } from './_generated';
/** @deprecated Use PluginMeta */
export type GeneratedToolMeta = GeneratedPluginMeta;

// Legacy alias
export type ToolMeta = PluginMeta;
