// goal: Types for tool registry
// eff: Unified types for both Tool and Module contexts

import type { ToolCategory } from '../../i18n/types';

export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled' | 'available';

/**
 * Unified tool/module metadata
 * Used by both TOOL_REGISTRY and ALL_TOOLS
 */
/**
 * Tool type: 'panel' (default) = React UI, 'script' = SaaT pseudo-tool (uses userScripts engine)
 */
export type ToolType = 'panel' | 'script';

export interface ToolMeta {
	id: string;
	icon: string;
	category: ToolCategory;
	status: ToolStatus;
	keywords: string[];
	/** Tool type: 'panel' for React UI, 'script' for SaaT pseudo-tools */
	toolType?: ToolType;
	features?: {
		contextMenu?: boolean;
		contentScript?: boolean;
		offscreen?: boolean;
	};
	system?: boolean;
	permissions?: string[];
	/** Script tool: URL match patterns (required if toolType='script') */
	scriptMatches?: string[];
	/** Script tool: Exclude URL patterns */
	scriptExcludeMatches?: string[];
	/** Script tool: Injection timing */
	scriptRunAt?: 'document_start' | 'document_end' | 'document_idle';
	/** Script tool: Code type */
	scriptType?: 'javascript' | 'css';
	// Module-specific fields (optional, used by ModuleStore)
	size?: number;
	builtIn?: boolean;
	name?: string; // Optional raw name (e.g. for user scripts)
	description?: string; // Optional description (e.g. for user scripts)
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
