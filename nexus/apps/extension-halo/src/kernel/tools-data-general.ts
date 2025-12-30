// goal: General Tools Data
// eff: Split from tools-data.ts

import type { ToolMeta } from './tool-registry-types';

export const TOOLS_GENERAL: ToolMeta[] = [
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
	{
		id: 'settings',
		icon: '⚙️',
		category: 'general',
		status: 'ready',
		keywords: ['settings', 'config', 'shezhi', '设置', '配置'],
	},
	{
		id: 'module-store',
		icon: '🧩',
		category: 'general',
		status: 'ready',
		keywords: ['module', 'store', 'plugin', 'mokuai', '模块', '商店'],
	},
];
