// goal: Types for plugin registry
// eff: Unified types for all plugin types (tool/script/system)

import type { ToolCategory } from '../../i18n/types';
import type { PluginType, ScriptType } from '../registry/taxonomy';

export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled' | 'available';

/**
 * Unified plugin metadata (used by PLUGIN_REGISTRY)
 * Legacy alias: ToolMeta = PluginMeta
 */
export interface PluginMeta {
	id: string;
	icon: string;
	pluginType: PluginType;
	category: ToolCategory;
	builtIn: boolean;
	keywords: string[];
	permissions?: string[];
	distribution?: 'bundled' | 'user-authored' | 'remote';
	background?: {
		mechanism: string;
		frequency: string;
		activeOnly: boolean;
		level: 'high' | 'medium' | 'low' | 'idle';
		descriptionKey: string;
		sourceFile: string;
		sourceAnchor: string;
		sourceDetail?: string;
	};
	// Script plugin config (only for pluginType='script')
	script?: {
		type: ScriptType;
		runAt: 'document_start' | 'document_end' | 'document_idle';
		matches: string[];
		excludeMatches?: string[];
		world?: 'ISOLATED' | 'MAIN' | 'USER_SCRIPT';
	};
	// Runtime-only fields (not from manifest)
	status?: ToolStatus;
	name?: string;
	description?: string;
	version?: string;
	isUserScript?: boolean;
}

// Legacy aliases for backward compatibility
export type ToolMeta = PluginMeta;
export type ModuleMeta = PluginMeta;
/** @deprecated Use PluginType from taxonomy.ts */
export type ToolType = PluginType;

export interface ToolPrefs {
	enabled: boolean;
	pinned: boolean;
	usageCount: number;
	lastUsed?: number;
}
