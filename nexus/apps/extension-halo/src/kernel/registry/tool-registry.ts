import type { ToolCategory } from '../../i18n/types';
import type { ToolMeta, ToolPrefs } from '../core/tool-registry-types';
import { ALL_APPS as GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';

// Tool installation status (used by Tool/Module Store)
export type ToolInstallStatus = 'available' | 'installed' | 'downloading' | 'updating' | 'error';

// Tool state (local installation status)
export interface ToolInstallState {
	id: string;
	status: ToolInstallStatus;
	installedVersion?: string;
	installedAt?: number;
	lastUsed?: number;
	error?: string;
}

// Tool manager state
export interface ToolInstallManagerState {
	tools: Record<string, ToolInstallState>;
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
		// Module/Extension-specific fields
		size: tool.size,
		builtIn: tool.builtIn,
		dependencies: tool.dependencies,
		version: '1.0.0',
	};
}

// Global Registry Arrays
export const ALL_TOOLS: ToolMeta[] = GENERATED_TOOLS.map(buildToolMeta);
export const CORE_TOOLS: ToolMeta[] = ALL_TOOLS.filter(t => t.builtIn);
export const OPTIONAL_TOOLS: ToolMeta[] = ALL_TOOLS.filter(t => !t.builtIn);

// Legacy/Compatibility export
export const TOOL_REGISTRY: ToolMeta[] = ALL_TOOLS;

export * from '../core/tool-registry-types';

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
	enabled: true,
	pinned: false,
	usageCount: 0,
};

export const TOOL_PREFS_KEY = 'halo_tool_prefs';

// Get tool by ID
export function getToolMeta(id: string): ToolMeta | undefined {
	return ALL_TOOLS.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): ToolMeta[] {
	return ALL_TOOLS.filter((t) => t.category === category);
}

// Get ready tools only
export function getReadyTools(): ToolMeta[] {
	return ALL_TOOLS.filter((t) => t.status === 'ready' || t.status === 'beta');
}

// Format size for display
export const formatToolSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};

// Re-export generated data
export { ALL_APPS as GENERATED_TOOLS, type GeneratedToolMeta } from './_generated';
