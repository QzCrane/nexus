// goal: Unified classification definition (SSOT)
// eff: Centralizes category IDs, Icons, SortOrder

import type { ToolCategory } from '../../i18n/types';

export interface CategoryDef {
	id: ToolCategory;
	icon: string;
	sortOrder: number;
	i18nKey: string;
}

// Plugin types (physical directory -> pluginType)
export type PluginType = 'tool' | 'script' | 'system';
export type ScriptType = 'javascript' | 'typescript' | 'css';

export const TAXONOMY: CategoryDef[] = [
	// Virtual category (runtime only, not in manifest)
	{ id: 'active', icon: '⚡', sortOrder: 0, i18nKey: 'categories.active' },

	// Core categories
	{ id: 'general', icon: '🏠', sortOrder: 10, i18nKey: 'categories.general' },

	// Developer tools (refined from old 'dev')
	{ id: 'encode', icon: '🔄', sortOrder: 20, i18nKey: 'categories.encode' },     // 编解码
	{ id: 'format', icon: '📝', sortOrder: 21, i18nKey: 'categories.format' },     // 格式化/转换
	{ id: 'network', icon: '🌐', sortOrder: 22, i18nKey: 'categories.network' },   // 网络/API
	{ id: 'data', icon: '📊', sortOrder: 23, i18nKey: 'categories.data' },         // 数据生成
	{ id: 'dev', icon: '👨‍💻', sortOrder: 24, i18nKey: 'categories.dev' },           // 开发工具

	// Productivity & Browser
	{ id: 'efficiency', icon: '🚀', sortOrder: 30, i18nKey: 'categories.efficiency' },
	{ id: 'browser', icon: '🔖', sortOrder: 40, i18nKey: 'categories.browser' },

	// Creative & Media
	{ id: 'visual', icon: '🎨', sortOrder: 50, i18nKey: 'categories.visual' },
	{ id: 'media', icon: '🎬', sortOrder: 60, i18nKey: 'categories.media' },

	// Security & AI
	{ id: 'security', icon: '🔒', sortOrder: 70, i18nKey: 'categories.security' },
	{ id: 'ai', icon: '🤖', sortOrder: 80, i18nKey: 'categories.ai' },

	// Virtual categories (aggregation views)
	{ id: 'scripts', icon: '📜', sortOrder: 5, i18nKey: 'categories.scripts' },   // 聚合所有脚本
	{ id: 'system', icon: '⚙️', sortOrder: 99, i18nKey: 'categories.system' },   // 系统组件
];

export const CATEGORY_IDS = TAXONOMY.map(c => c.id);
