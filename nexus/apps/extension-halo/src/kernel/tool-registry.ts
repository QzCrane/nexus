// goal: Centralized tool registry system
// tradeoff: Flexibility vs type safety - use metadata for extensibility
// eff: Single source of truth for all tools

import type { ToolCategory } from '../i18n/types';

// Tool status
export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled';

// Tool metadata definition
export interface ToolMeta {
	id: string;
	icon: string;
	category: ToolCategory;
	status: ToolStatus;
	// Search keywords (both zh + en)
	keywords: string[];
	// Feature flags for advanced features
	features?: {
		contextMenu?: boolean;   // Right-click integration
		contentScript?: boolean; // Needs content script
		offscreen?: boolean;     // Needs offscreen document
	};
}

// User preferences per tool
export interface ToolPrefs {
	enabled: boolean;
	pinned: boolean;
	usageCount: number;
	lastUsed?: number;
}

// All registered tools
export const TOOL_REGISTRY: ToolMeta[] = [
	// === General ===
	{
		id: 'qrcode',
		icon: '🔲',
		category: 'general',
		status: 'ready',
		keywords: ['qr', 'code', 'scan', 'erweima', '二维码', '扫码'],
		features: { contextMenu: true },
	},
	{
		id: 'color-picker',
		icon: '🎨',
		category: 'general',
		status: 'ready',
		keywords: ['color', 'picker', 'hex', 'rgb', 'hsl', 'yanse', '颜色', '取色'],
		features: { contentScript: true },
	},
	{
		id: 'ruler',
		icon: '📐',
		category: 'general',
		status: 'ready',
		keywords: ['ruler', 'measure', 'pixel', 'chizi', '尺子', '测量'],
		features: { contentScript: true },
	},
	{
		id: 'outline',
		icon: '📋',
		category: 'general',
		status: 'ready',
		keywords: ['outline', 'heading', 'toc', 'dagang', '大纲', '目录', '标题'],
		features: { contentScript: true },
	},

	// === Developer ===
	{
		id: 'json-formatter',
		icon: '{}',
		category: 'dev',
		status: 'ready',
		keywords: ['json', 'format', 'geshihua', '格式化', '美化'],
	},
	{
		id: 'regex',
		icon: '.*',
		category: 'dev',
		status: 'coming',
		keywords: ['regex', 'regexp', 'regular', 'zhengze', '正则'],
	},
	{
		id: 'base64',
		icon: '🔐',
		category: 'dev',
		status: 'coming',
		keywords: ['base64', 'encode', 'decode', 'bianma', '编码', '解码'],
	},

	// === Efficiency ===
	{
		id: 'clipboard',
		icon: '📎',
		category: 'efficiency',
		status: 'coming',
		keywords: ['clipboard', 'copy', 'paste', 'jiantiepan', '剪贴板', '复制'],
	},
	{
		id: 'screenshot',
		icon: '📸',
		category: 'efficiency',
		status: 'coming',
		keywords: ['screenshot', 'capture', 'jietu', '截图', '截屏'],
		features: { contentScript: true },
	},
	{
		id: 'timer',
		icon: '⏱️',
		category: 'efficiency',
		status: 'coming',
		keywords: ['timer', 'pomodoro', 'stopwatch', 'jishiqi', '计时器', '番茄钟'],
	},
	{
		id: 'notes',
		icon: '📝',
		category: 'efficiency',
		status: 'coming',
		keywords: ['notes', 'memo', 'quick', 'biji', '便签', '笔记'],
	},

	// === Visual ===
	{
		id: 'pdf',
		icon: '📄',
		category: 'visual',
		status: 'coming',
		keywords: ['pdf', 'merge', 'split', 'compress', 'hebing', '合并', '拆分'],
		features: { offscreen: true },
	},
	{
		id: 'archive',
		icon: '💾',
		category: 'visual',
		status: 'coming',
		keywords: ['archive', 'save', 'offline', 'cundang', '存档', '离线'],
		features: { contentScript: true },
	},

	// === System ===
	{
		id: 'settings',
		icon: '⚙️',
		category: 'general',
		status: 'ready',
		keywords: ['settings', 'config', 'shezhi', '设置', '配置'],
	},
];

// Default preferences for new tools
export const DEFAULT_TOOL_PREFS: ToolPrefs = {
	enabled: true,
	pinned: false,
	usageCount: 0,
};

// Storage key for tool preferences
export const TOOL_PREFS_KEY = 'halo_tool_prefs';

// Get tool by ID
export function getToolMeta(id: string): ToolMeta | undefined {
	return TOOL_REGISTRY.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): ToolMeta[] {
	return TOOL_REGISTRY.filter((t) => t.category === category);
}

// Get ready tools only
export function getReadyTools(): ToolMeta[] {
	return TOOL_REGISTRY.filter((t) => t.status === 'ready' || t.status === 'beta');
}
