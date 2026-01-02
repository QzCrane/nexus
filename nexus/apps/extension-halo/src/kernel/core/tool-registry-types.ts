// goal: Types for tool registry
// eff: Unified types for both Tool and Module contexts

import type { ToolCategory } from '../../i18n/types';

export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled' | 'available';

/**
 * Unified tool/module metadata
 * Used by both TOOL_REGISTRY and ALL_MODULES
 */
export interface ToolMeta {
	id: string;
	icon: string;
	category: ToolCategory;
	status: ToolStatus;
	keywords: string[];
	features?: {
		contextMenu?: boolean;
		contentScript?: boolean;
		offscreen?: boolean;
	};
	system?: boolean;
	// Module-specific fields (optional, used by ModuleStore)
	size?: number;
	builtIn?: boolean;
	dependencies?: string[];
	bundleUrl?: string;
	version?: string;
}

/**
 * @deprecated Use ToolMeta directly - unified interface
 */
export type ModuleMeta = ToolMeta;

export interface ToolPrefs {
	enabled: boolean;
	pinned: boolean;
	usageCount: number;
	lastUsed?: number;
}
