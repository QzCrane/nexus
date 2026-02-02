// goal: Centralized tool registry system
// tradeoff: Flexibility vs type safety - use metadata for extensibility
// eff: Single source of truth for all tools

import type { ToolCategory } from '../i18n/types';
import type { PluginMeta, ToolPrefs } from './core/tool-registry-types';

// Re-export for compatibility
export type { PluginMeta, ToolPrefs };
export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled';
// Alias for backward compatibility (but prefer PluginMeta)
export type ToolMeta = PluginMeta;

// All registered tools
export const TOOL_REGISTRY: PluginMeta[] = [
	// === Scripts (SaaT) ===
	{
		id: 'llm-enhancer',
		icon: '🧠',
		category: 'ai',
		pluginType: 'tool',
		builtIn: true,
		status: 'beta',
		keywords: ['chatgpt', 'deepseek', 'gemini', 'claude', 'wide', 'wide-screen', 'timeline', 'llm', 'ai'],
		script: {
			type: 'javascript',
			runAt: 'document_end', // V3 uses document_end to ensure DOM for observing
			matches: [
				'*://chatgpt.com/*',
				'*://chat.openai.com/*',
				'*://chat.deepseek.com/*',
				'*://gemini.google.com/*',
				'*://aistudio.google.com/*',
				'*://claude.ai/*'
			]
		}
	},
	{
		id: 'bilibili-enhancer',
		icon: '📺',
		category: 'efficiency',
		pluginType: 'script',
		builtIn: true,
		status: 'beta',
		keywords: ['bilibili', 'video', 'clean', 'rate', 'speed', 'bili'],
		script: {
			type: 'javascript',
			runAt: 'document_end',
			matches: [
				'*://www.bilibili.com/*',
				'*://live.bilibili.com/*'
			]
		}
	},

	// === General ===
	{
		id: 'qrcode',
		icon: '🔲',
		category: 'general',
		pluginType: 'tool',
		builtIn: true,
		status: 'ready',
		keywords: ['qr', 'code', 'scan', 'erweima', '二维码', '扫码'],
		// features: { contextMenu: true }, // Logic handled in background, flag for metadata
	},
	{
		id: 'color-picker',
		icon: '🎨',
		category: 'general',
		pluginType: 'tool',
		builtIn: true,
		status: 'ready',
		keywords: ['color', 'picker', 'hex', 'rgb', 'hsl', 'yanse', '颜色', '取色'],
		// features: { contentScript: true },
	},
	{
		id: 'ruler',
		icon: '📐',
		category: 'general',
		pluginType: 'tool',
		builtIn: true,
		status: 'ready',
		keywords: ['ruler', 'measure', 'pixel', 'chizi', '尺子', '测量'],
		// features: { contentScript: true },
	},
	{
		id: 'outline',
		icon: '📋',
		category: 'general',
		pluginType: 'tool',
		builtIn: true,
		status: 'ready',
		keywords: ['outline', 'heading', 'toc', 'dagang', '大纲', '目录', '标题'],
		// features: { contentScript: true },
	},

	// === Developer ===
	{
		id: 'json-formatter',
		icon: '{}',
		category: 'dev',
		pluginType: 'tool',
		builtIn: true,
		status: 'ready',
		keywords: ['json', 'format', 'geshihua', '格式化', '美化'],
	},
	{
		id: 'regex',
		icon: '.*',
		category: 'dev',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['regex', 'regexp', 'regular', 'zhengze', '正则'],
	},
	{
		id: 'base64',
		icon: '🔐',
		category: 'dev',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['base64', 'encode', 'decode', 'bianma', '编码', '解码'],
	},

	// === Efficiency ===
	{
		id: 'clipboard',
		icon: '📎',
		category: 'efficiency',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['clipboard', 'copy', 'paste', 'jiantiepan', '剪贴板', '复制'],
	},
	{
		id: 'screenshot',
		icon: '📸',
		category: 'efficiency',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['screenshot', 'capture', 'jietu', '截图', '截屏'],
		// features: { contentScript: true },
	},
	{
		id: 'timer',
		icon: '⏱️',
		category: 'efficiency',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['timer', 'pomodoro', 'stopwatch', 'jishiqi', '计时器', '番茄钟'],
	},
	{
		id: 'notes',
		icon: '📝',
		category: 'efficiency',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['notes', 'memo', 'quick', 'biji', '便签', '笔记'],
	},

	// === Visual ===
	{
		id: 'pdf',
		icon: '📄',
		category: 'visual',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['pdf', 'merge', 'split', 'compress', 'hebing', '合并', '拆分'],
		// features: { offscreen: true },
	},
	{
		id: 'archive',
		icon: '💾',
		category: 'visual',
		pluginType: 'tool',
		builtIn: true,
		status: 'coming',
		keywords: ['archive', 'save', 'offline', 'cundang', '存档', '离线'],
		// features: { contentScript: true },
	},

	// === System ===
	{
		id: 'settings',
		icon: '⚙️',
		category: 'general',
		pluginType: 'tool',
		builtIn: true,
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
export function getToolMeta(id: string): PluginMeta | undefined {
	return TOOL_REGISTRY.find((t) => t.id === id);
}

// Get tools by category
export function getToolsByCategory(category: ToolCategory): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.category === category);
}

// Get ready tools only
export function getReadyTools(): PluginMeta[] {
	return TOOL_REGISTRY.filter((t) => t.status === 'ready' || t.status === 'beta');
}
