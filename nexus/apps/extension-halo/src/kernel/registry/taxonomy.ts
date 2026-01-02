// goal: Unified classification definition (SSOT)
// eff: Centralizes category IDs, Icons, SortOrder

import type { ToolCategory } from '../../i18n/types';

export interface CategoryDef {
	id: ToolCategory;
	icon: string;
	sortOrder: number;
	i18nKey: string;
}

export const TAXONOMY: CategoryDef[] = [
	{ id: 'active', icon: '⚡', sortOrder: 0, i18nKey: 'categories.active' },
	{ id: 'general', icon: '🏠', sortOrder: 10, i18nKey: 'categories.general' },
	{ id: 'dev', icon: '👨‍💻', sortOrder: 20, i18nKey: 'categories.dev' },
	{ id: 'efficiency', icon: '🚀', sortOrder: 30, i18nKey: 'categories.efficiency' },
	{ id: 'browser', icon: '🌐', sortOrder: 40, i18nKey: 'categories.browser' },
	{ id: 'visual', icon: '🎨', sortOrder: 50, i18nKey: 'categories.visual' },
	{ id: 'media', icon: '🎬', sortOrder: 60, i18nKey: 'categories.media' },
	{ id: 'security', icon: '🔒', sortOrder: 70, i18nKey: 'categories.security' },
	{ id: 'ai', icon: '🤖', sortOrder: 80, i18nKey: 'categories.ai' },
];

export const CATEGORY_IDS = TAXONOMY.map(c => c.id);
