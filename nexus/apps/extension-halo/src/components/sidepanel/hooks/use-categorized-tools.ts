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
	visibleTools,
	settings,
	t,
	activeServices,
	backgroundToolIds,
	scripts,
	tempCats,
	tempCatOrder
}: UseCategorizedToolsProps) {
	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;
		const cats: Record<string, ToolMeta[]> = { active: [], scripts: [], system: [], general: [], dev: [], efficiency: [], visual: [], ai: [], security: [], media: [], browser: [] };

		// 1. Process builtin/registry tools
		visibleTools.forEach(tool => {
			if (tool.system) {
				if (settings?.showSystemTools) {
					cats.system.push(tool);
				}
				// Also add system tools to 'active' if they are background capable
				if (backgroundToolIds.includes(tool.id)) {
					cats.active.push(tool);
				}
				return;
			}

			// SaaT script tools go to scripts category
			if (tool.toolType === 'script') {
				cats.scripts.push(tool);
				return;
			}

			// Include in "Active Services" if it is background capable (even if disabled)
			// This allows showing "inactive" state (grey dot) instead of hiding
			if (backgroundToolIds.includes(tool.id)) {
				cats.active.push(tool);
			}

			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general.push(tool);
		});

		// 2. Merge User Scripts from storage
		// Collect registered SaaT IDs from tools registry (these have id matching tool.id)
		const registeredSaaTIds = new Set(cats.scripts.map(t => t.id));

		scripts.forEach(script => {
			// Skip SaaT scripts (those with id starting with 'saat-') that already have a tool in registry
			// SaaT IDs format: 'saat-{toolId}-{timestamp}', e.g. 'saat-bilibili-plus-1767413981425'
			if (script.id.startsWith('saat-')) {
				// Extract tool ID by removing prefix and timestamp suffix
				const match = script.id.match(/^saat-(.+)-\d+$/);
				const toolId = match?.[1];
				if (toolId && registeredSaaTIds.has(toolId)) return;
			}
			// Skip if this user script id is already in the scripts category
			if (registeredSaaTIds.has(script.id)) return;

			// Create pseudo ToolMeta for user script
			const scriptTool: ToolMeta = {
				id: script.id,
				name: script.name, // Use raw name (no i18n for user scripts)
				description: script.description,
				icon: script.type === 'css' ? '🎨' : '⚡',
				category: 'scripts',
				toolType: 'script',
				size: script.code.length,
				builtIn: false,
				status: 'ready',
				keywords: ['script', 'user'],
				// Mark as user script for rendering special actions
				isUserScript: true
			} as ToolMeta & { isUserScript?: boolean };

			cats.scripts.push(scriptTool);
		});

		Object.keys(cats).forEach(cat => {
			const pinned = settings?.pinnedTools || [], order = settings?.toolOrder?.[cat] || [];
			cats[cat].sort((a, b) => {
				const ap = pinned.includes(a.id), bp = pinned.includes(b.id);
				if (ap !== bp) return ap ? -1 : 1;
				const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
				if (ai !== -1 && bi !== -1) return ai - bi;
				// Use raw name for sorting if i18n key not found/is raw
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

		// Ensure active, scripts, system are always present if they have tools (or if default requires them)
		// We re-inject them to ensure they appear even if user config is old
		// Specifically system if enabled
		if (!order.includes('system') && settings?.showSystemTools) {
			// Insert system after scripts or at beginning
			const scriptIdx = order.indexOf('scripts');
			if (scriptIdx !== -1) order.splice(scriptIdx + 1, 0, 'system');
			else order.unshift('system');
		}

		// Ensure active is always present
		if (!order.includes('active')) {
			order = ['active', ...order];
		}

		// Ensure scripts is always present
		if (!order.includes('scripts')) {
			order = ['active', 'scripts', ...order.filter((o: string) => o !== 'active')];
		}

		return order;
	}, [settings, tempCatOrder]);

	return { categorizedTools, catOrder };
}
