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
				// System plugins - show if enabled
				if (settings?.showSystemTools) cats.system.push(tool);
				// Add to active ONLY if background capable AND not 'userscripts'
				// (userscripts as a panel shouldn't appear in active services)
				if (backgroundToolIds.includes(tool.id) && tool.id !== 'userscripts') {
					cats.active.push(tool);
				}
				return;
			}

			// SaaT script tools (bilibili-plus, chatgpt-wide etc.) go to scripts category
			if (tool.toolType === 'script') {
				cats.scripts.push(tool);
				return;
			}

			// Regular tools to active services if background capable
			if (backgroundToolIds.includes(tool.id)) cats.active.push(tool);
			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general.push(tool);
		});

		// Note: User scripts from storage are NOT shown on main homepage
		// They are only managed via the userscripts panel

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
