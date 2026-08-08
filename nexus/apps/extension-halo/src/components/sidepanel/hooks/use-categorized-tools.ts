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
const CATEGORY_ID_SET = new Set(CATEGORY_IDS);
const SPECIAL_CATEGORY_IDS = new Set(['active', 'scripts', 'system']);

export function resolveCategoryOrder(
	settings: Pick<HaloSettings, 'categoryOrder' | 'showSystemTools'> | null,
	tempCatOrder: readonly string[] | null,
): string[] {
	if (tempCatOrder) return [...tempCatOrder];

	const functionalCats = TAXONOMY
		.filter((category) => !SPECIAL_CATEGORY_IDS.has(category.id))
		.sort((left, right) => left.sortOrder - right.sortOrder)
		.map((category) => category.id);

	// Never mutate persisted settings during render. Canonicalize stale/duplicate
	// category ids at the projection boundary and append newly introduced taxonomy
	// categories so an old preference cannot make a new tool category unreachable.
	const seen = new Set<string>();
	const order = (settings?.categoryOrder ?? []).filter((categoryId) => {
		if (!CATEGORY_ID_SET.has(categoryId) || seen.has(categoryId)) return false;
		seen.add(categoryId);
		return true;
	});
	const insertAfter = (anchor: string, categoryId: string): void => {
		if (order.includes(categoryId)) return;
		const anchorIndex = order.indexOf(anchor);
		order.splice(anchorIndex >= 0 ? anchorIndex + 1 : 0, 0, categoryId);
	};

	if (!order.includes('active')) order.unshift('active');
	insertAfter('active', 'scripts');
	if (settings?.showSystemTools) insertAfter('scripts', 'system');
	else {
		const systemIndex = order.indexOf('system');
		if (systemIndex >= 0) order.splice(systemIndex, 1);
	}
	for (const categoryId of functionalCats) {
		if (!order.includes(categoryId)) order.push(categoryId);
	}
	return order;
}

export function useCategorizedTools({
	visibleTools, settings, t, activeServices, backgroundToolIds, scripts, tempCats, tempCatOrder
}: UseCategorizedToolsProps) {
	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;

		const cats: Record<string, PluginMeta[]> = {};
		CATEGORY_IDS.forEach((id) => { cats[id] = []; });
		const backgroundToolIdSet = new Set(backgroundToolIds);

		visibleTools.forEach((tool) => {
			if (tool.pluginType === 'system') {
				if (settings?.showSystemTools) cats.system?.push(tool);

				// Startup classification only needs activeOnly; detailed resource
				// provenance remains in the lazy Resource Monitor path.
				if (
					backgroundToolIdSet.has(tool.id)
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

			if (backgroundToolIdSet.has(tool.id) || activeServices.has(tool.id)) cats.active?.push(tool);
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

		const pinnedSet = new Set(settings?.pinnedTools ?? []);
		const labelCache = new Map<string, string>();
		const labelFor = (tool: PluginMeta): string => {
			const cached = labelCache.get(tool.id);
			if (cached !== undefined) return cached;
			const key = `tools.${tool.id}.name`;
			const translated = t(key);
			const label = (translated === key ? tool.name || tool.id : translated) || tool.id;
			labelCache.set(tool.id, label);
			return label;
		};

		Object.entries(cats).forEach(([categoryId, tools]) => {
			const order = settings?.toolOrder?.[categoryId] ?? [];
			const orderRank = new Map(order.map((id, index) => [id, index]));
			tools.sort((left, right) => {
				const leftPinned = pinnedSet.has(left.id);
				const rightPinned = pinnedSet.has(right.id);
				if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
				const leftIndex = orderRank.get(left.id);
				const rightIndex = orderRank.get(right.id);
				if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
				if (leftIndex !== undefined) return -1;
				if (rightIndex !== undefined) return 1;
				return labelFor(left).localeCompare(labelFor(right));
			});
		});
		return cats;
	}, [visibleTools, settings, t, tempCats, activeServices, backgroundToolIds, scripts]);

	const catOrder = useMemo(
		() => resolveCategoryOrder(settings, tempCatOrder),
		[settings, tempCatOrder],
	);

	return { categorizedTools, catOrder };
}
