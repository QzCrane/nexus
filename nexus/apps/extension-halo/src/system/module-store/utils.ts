// goal: Utility functions for module-store panel
// eff: Script module conversion and filtering logic

import type { ToolMeta } from '../../kernel/core/tool-registry-types';
import type { UserScript } from '../userscripts/types';
import { ALL_MODULES } from '../../kernel';

/**
 * Convert user scripts to module format for display in module store
 * Filters out SaaT scripts that are already registered in ALL_MODULES
 */
export function convertScriptsToModules(scripts: UserScript[]): ToolMeta[] {
	const builtInScriptIds = ALL_MODULES.filter(m => m.toolType === 'script').map(m => m.id);

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
			category: 'scripts' as const,
			toolType: 'script' as const,
			scriptType: s.type,
			builtIn: false,
			size: s.code.length,
			system: false,
			status: 'ready' as const,
			keywords: ['script', 'user', s.type]
		})) as ToolMeta[];
}
