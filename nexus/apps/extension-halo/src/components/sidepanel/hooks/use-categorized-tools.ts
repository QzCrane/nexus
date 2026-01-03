import { useMemo } from 'react';
import type { ToolMeta } from '../../../kernel/core/tool-registry-types';
import type { HaloSettings } from '../../../kernel/core/settings';
import type { UserScript } from '../../../system/userscripts/types';

interface UseCategorizedToolsProps {
	visibleTools: ToolMeta[];
	settings: HaloSettings | null;
	t: (key: string) => string;
	activeServices: Set<string>;
	backgroundToolIds: string[];
	scripts: UserScript[];
	tempCats: Record<string, ToolMeta[]> | null;
	tempCatOrder: string[] | null;
}

export function useCategorizedTools({
	visibleTools, settings, t, activeServices, backgroundToolIds, scripts, tempCats, tempCatOrder
}: UseCategorizedToolsProps) {
	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;
		const cats: Record<string, ToolMeta[]> = {
			active: [], scripts: [], system: [], general: [], dev: [],
			efficiency: [], visual: [], ai: [], security: [], media: [], browser: []
		};

		// 1. Process builtin/registry tools
		visibleTools.forEach(tool => {
			if (tool.system) {
				if (settings?.showSystemTools) cats.system.push(tool);
				// System tools in active only if background capable (except userscripts panel)
				if (backgroundToolIds.includes(tool.id) && tool.id !== 'userscripts') {
					cats.active.push(tool);
				}
				return;
			}

			// Script tools (from scripts/ directory)
			if (tool.toolType === 'script') {
				// Always show in scripts category
				cats.scripts.push(tool);
				// Also show in Active Services if the script is enabled
				if (activeServices.has(tool.id)) {
					cats.active.push(tool);
				}
				return;
			}

			// Regular tools
			if (backgroundToolIds.includes(tool.id)) cats.active.push(tool);
			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general.push(tool);
		});

		// 2. Process user scripts
		scripts.forEach(script => {
			// Skip SaaT scripts that are already processed above via visibleTools (they are in registry)
			// SaaT scripts in 'scripts' array have 'saatToolId'.
			// We only want PURE user scripts here?
			// Wait, visibleTools are REGISTRY tools. Scripts in storage (UserScript[]) include BOTH pure user scripts and SaaT wrappers.
			// Currently, SaaT wrappers in storage have `saatToolId` pointing to registry ID.
			// Pure user scripts (created manually) do NOT have `saatToolId`.

			if ((script as any).saatToolId) return; // Skip shadows of official scripts

			const meta: ToolMeta = {
				id: script.id,
				name: script.name,
				description: script.description || 'User Script',
				category: 'scripts',
				toolType: 'script',
				icon: '📜',
				version: '0.0.0',
				size: script.code.length,
				builtIn: false,
				system: false,
				status: 'ready',
				keywords: ['script', 'user', script.type],
				scriptType: script.type,
				scriptMatches: script.matches,
				// Add flag for UI to know it's a user script
				// isUserScript: true // ToolMeta type doesn't have this, but runtime works
			};
			(meta as any).isUserScript = true;

			cats.scripts.push(meta);

			// Check active state
			// For user scripts, 'enabled' property is truth. Also checked against activeServices set for consistency.
			if (script.enabled || activeServices.has(script.id)) {
				cats.active.push(meta);
			}
		});

		// 2. Sort each category
		Object.keys(cats).forEach(cat => {
			const pinned = settings?.pinnedTools || [], order = settings?.toolOrder?.[cat] || [];
			cats[cat].sort((a, b) => {
				const ap = pinned.includes(a.id), bp = pinned.includes(b.id);
				if (ap !== bp) return ap ? -1 : 1;
				const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
				if (ai !== -1 && bi !== -1) return ai - bi;
				const nameA = (t(`tools.${a.id}.name`) === `tools.${a.id}.name` ? (a.name || a.id) : t(`tools.${a.id}.name`)) || a.id;
				const nameB = (t(`tools.${b.id}.name`) === `tools.${b.id}.name` ? (b.name || b.id) : t(`tools.${b.id}.name`)) || b.id;
				return ai !== -1 ? -1 : bi !== -1 ? 1 : nameA.localeCompare(nameB);
			});
		});
		return cats;
	}, [visibleTools, settings, t, tempCats, activeServices, backgroundToolIds, scripts]);

	const catOrder = useMemo(() => {
		if (tempCatOrder) return tempCatOrder;
		const defaultOrder = ['active', 'scripts', 'system', 'general', 'dev', 'efficiency', 'visual', 'ai', 'security', 'media', 'browser'];
		let order = settings?.categoryOrder || [];
		if (order.length === 0) order = defaultOrder;

		if (!order.includes('system') && settings?.showSystemTools) {
			const scriptIdx = order.indexOf('scripts');
			if (scriptIdx !== -1) order.splice(scriptIdx + 1, 0, 'system');
			else order.unshift('system');
		}
		if (!order.includes('active')) order = ['active', ...order];
		if (!order.includes('scripts')) order = ['active', 'scripts', ...order.filter((o: string) => o !== 'active')];
		return order;
	}, [settings, tempCatOrder]);

	return { categorizedTools, catOrder };
}
