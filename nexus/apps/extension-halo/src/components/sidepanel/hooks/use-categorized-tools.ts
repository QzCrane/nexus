import { useMemo } from 'react';
import type { PluginMeta } from '../../../kernel/core/tool-registry-types';
import type { HaloSettings } from '../../../kernel/core/settings';
import type { UserScript } from '../../../system/userscripts/types';
import { BACKGROUND_ACTIVE_ONLY_MAP } from '../../../kernel/registry/_generated-background-active';
import { TAXONOMY } from '../../../kernel/registry/taxonomy';

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
const CATEGORY_IDS = TAXONOMY.map((category) => category.id);

export function useCategorizedTools({
	visibleTools, settings, t, activeServices, backgroundToolIds, scripts, tempCats, tempCatOrder
}: UseCategorizedToolsProps) {
	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;

		const cats: Record<string, PluginMeta[]> = {};
		CATEGORY_IDS.forEach((id) => { cats[id] = []; });

		visibleTools.forEach((tool) => {
			if (tool.pluginType === 'system') {
				if (settings?.showSystemTools) cats.system?.push(tool);

				// Startup classification only needs activeOnly; detailed resource
				// provenance remains in the lazy Resource Monitor path.
				if (
					backgroundToolIds.includes(tool.id)
					&& BACKGROUND_ACTIVE_ONLY_MAP[tool.id] === false
				) {
					cats.active?.push(tool);
				}
				return;
			}

			if (tool.pluginType === 'script') {
				const category = cats[tool.category];
				if (category) category.push(tool);
				cats.scripts?.push(tool);
				if (activeServices.has(tool.id)) cats.active?.push(tool);
				return;
			}

			if (backgroundToolIds.includes(tool.id) || activeServices.has(tool.id)) cats.active?.push(tool);
			const category = cats[tool.category];
			if (category) category.push(tool);
			else cats.general?.push(tool);
		});

		scripts.forEach((script) => {
			if (script.saatToolId) return;

			const meta: PluginMeta = {
				id: script.id,
				name: script.name,
				description: script.description || 'User Script',
				category: 'dev',
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
				isUserScript: true,
			};

			cats.dev?.push(meta);
			cats.scripts?.push(meta);
			if (script.enabled || activeServices.has(script.id)) cats.active?.push(meta);
		});

		Object.entries(cats).forEach(([categoryId, tools]) => {
			const pinned = settings?.pinnedTools || [];
			const order = settings?.toolOrder?.[categoryId] || [];
			tools.sort((left, right) => {
				const leftPinned = pinned.includes(left.id);
				const rightPinned = pinned.includes(right.id);
				if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
				const leftIndex = order.indexOf(left.id);
				const rightIndex = order.indexOf(right.id);
				if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
				const leftName = (t(`tools.${left.id}.name`) === `tools.${left.id}.name`
					? (left.name || left.id)
					: t(`tools.${left.id}.name`)) || left.id;
				const rightName = (t(`tools.${right.id}.name`) === `tools.${right.id}.name`
					? (right.name || right.id)
					: t(`tools.${right.id}.name`)) || right.id;
				return leftIndex !== -1 ? -1 : rightIndex !== -1 ? 1 : leftName.localeCompare(rightName);
			});
		});
		return cats;
	}, [visibleTools, settings, t, tempCats, activeServices, backgroundToolIds, scripts]);

	const catOrder = useMemo(() => {
		if (tempCatOrder) return tempCatOrder;

		const functionalCats = TAXONOMY
			.filter((category) => !['active', 'scripts', 'system'].includes(category.id))
			.sort((left, right) => left.sortOrder - right.sortOrder)
			.map((category) => category.id);

		let order = settings?.categoryOrder || [];

		if (order.length === 0) {
			order = ['active', 'scripts'];
			if (settings?.showSystemTools) order.push('system');
			order = [...order, ...functionalCats];
		} else {
			if (!order.includes('active')) order = ['active', ...order];
			if (!order.includes('scripts')) {
				const activeIndex = order.indexOf('active');
				order.splice(activeIndex + 1, 0, 'scripts');
			}
			if (!order.includes('system') && settings?.showSystemTools) {
				const scriptsIndex = order.indexOf('scripts');
				order.splice(scriptsIndex + 1, 0, 'system');
			}
		}

		return order;
	}, [settings, tempCatOrder]);

	return { categorizedTools, catOrder };
}
