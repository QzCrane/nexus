import { useMemo } from 'react';
import type { PluginMeta } from '../../../kernel/core/tool-registry-types';
import type { HaloSettings } from '../../../kernel/core/settings';
import type { UserScript } from '../../../system/userscripts/types';
import { BACKGROUND_PROFILES_MAP } from "../../../kernel/registry/_generated";
import { TAXONOMY } from "../../../kernel/registry/taxonomy";

interface UseCategorizedToolsProps {
	visibleTools: PluginMeta[];
	settings: HaloSettings | null;
	t: (key: string) => string;
	activeServices: Set<string>;
	backgroundToolIds: string[];
	scripts: UserScript[];
	tempCats: Record<string, PluginMeta[]> | null;
	tempCatOrder: string[] | null;
}

// Build dynamic category keys from TAXONOMY (SSOT)
const CATEGORY_IDS = TAXONOMY.map(c => c.id);

export function useCategorizedTools({
	visibleTools, settings, t, activeServices, backgroundToolIds, scripts, tempCats, tempCatOrder
}: UseCategorizedToolsProps) {
	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;

		// Initialize all categories dynamically from TAXONOMY
		const cats: Record<string, PluginMeta[]> = {};
		CATEGORY_IDS.forEach(id => { cats[id] = []; });

		// 1. Process builtin/registry tools
		visibleTools.forEach(tool => {
			// System plugins: only show if enabled in settings
			if (tool.pluginType === 'system') {
				if (settings?.showSystemTools) cats.system?.push(tool);

				// System tools that are global background services -> also in 'active'
				if (backgroundToolIds.includes(tool.id)) {
					const profile = BACKGROUND_PROFILES_MAP[tool.id];
					if (profile && !profile.activeOnly) {
						cats.active?.push(tool);
					}
				}
				return;
			}

			// Script plugins: show in their functional category AND scripts aggregation
			if (tool.pluginType === 'script') {
				// Add to functional category
				if (cats[tool.category]) {
					cats[tool.category].push(tool);
				}
				// Also add to scripts aggregation category
				cats.scripts?.push(tool);
				// Also show in Active Services if enabled
				if (activeServices.has(tool.id)) {
					cats.active?.push(tool);
				}
				return;
			}

			// Regular tool plugins
			if (backgroundToolIds.includes(tool.id)) cats.active?.push(tool);
			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general?.push(tool);
		});

		// 2. Process user scripts (non-SaaT)
		scripts.forEach(script => {
			// Skip SaaT wrappers (already in registry)
			if ((script as any).saatToolId) return;

			const meta: PluginMeta = {
				id: script.id,
				name: script.name,
				description: script.description || 'User Script',
				category: 'dev', // User scripts go to dev category
				pluginType: 'script',
				icon: '📜',
				builtIn: false,
				status: 'ready',
				keywords: ['script', 'user', script.type],
				script: {
					type: script.type,
					matches: script.matches,
					runAt: script.runAt || 'document_idle',
				},
			};
			(meta as any).isUserScript = true;

			// Add to functional category (dev)
			cats.dev?.push(meta);
			// Also add to scripts aggregation
			cats.scripts?.push(meta);

			// Check active state
			if (script.enabled || activeServices.has(script.id)) {
				cats.active?.push(meta);
			}
		});

		// 3. Sort each category
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

		// Functional categories from TAXONOMY (exclude virtual/special categories)
		const functionalCats = TAXONOMY
			.filter(c => !['active', 'scripts', 'system'].includes(c.id))
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map(c => c.id);

		let order = settings?.categoryOrder || [];

		if (order.length === 0) {
			// Default order: active, scripts, system first, then functional
			order = ['active', 'scripts'];
			if (settings?.showSystemTools) order.push('system');
			order = [...order, ...functionalCats];
		} else {
			// Ensure special categories are included
			if (!order.includes('active')) order = ['active', ...order];
			if (!order.includes('scripts')) {
				const activeIdx = order.indexOf('active');
				order.splice(activeIdx + 1, 0, 'scripts');
			}
			if (!order.includes('system') && settings?.showSystemTools) {
				const scriptsIdx = order.indexOf('scripts');
				order.splice(scriptsIdx + 1, 0, 'system');
			}
		}

		return order;
	}, [settings, tempCatOrder]);

	return { categorizedTools, catOrder };
}
