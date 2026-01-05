// goal: Utility functions for module-store panel
// eff: Script module conversion and filtering logic

import type { PluginMeta } from '../../kernel/core/tool-registry-types';
import type { UserScript } from '../userscripts/types';
import { ALL_MODULES } from '../../kernel';

/**
 * Convert user scripts to module format for display in module store
 * Filters out SaaT scripts that are already registered in ALL_MODULES
 */
export function convertScriptsToModules(scripts: UserScript[]): PluginMeta[] {
	// Get IDs of built-in script plugins
	const builtInScriptIds = ALL_MODULES
		.filter(m => m.pluginType === 'script')
		.map(m => m.id);

	return scripts
		.filter(s => {
			// Exclude SaaT scripts (they have their tool registered in ALL_MODULES)
			if (s.id.startsWith('saat-')) return false;
			// Exclude if the name matches a built-in script tool
			if (builtInScriptIds.includes(s.name)) return false;
			return true;
		})
		.map(s => ({
			id: s.id,
			name: s.name,
			description: s.description,
			icon: s.type === 'css' ? '🎨' : '⚡',
			category: 'dev' as const, // User scripts go to dev category
			pluginType: 'script' as const,
			builtIn: false,
			size: s.code.length,
			status: 'ready' as const,
			keywords: ['script', 'user', s.type],
			script: {
				type: s.type,
				matches: s.matches,
				runAt: s.runAt || 'document_idle',
			},
			isUserScript: true
		})) as any[] as PluginMeta[];
}
