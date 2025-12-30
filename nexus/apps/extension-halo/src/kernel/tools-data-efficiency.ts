// goal: Efficiency Tools Data
// eff: Split from tools-data.ts

import type { ToolMeta } from './tool-registry-types';

export const TOOLS_EFFICIENCY: ToolMeta[] = [
	{
		id: 'clipboard',
		icon: '📎',
		category: 'efficiency',
		status: 'ready',
		keywords: ['clipboard', 'copy', 'paste', 'jiantiepan', '剪贴板', '复制'],
	},
	{
		id: 'smooth-scroll',
		icon: '📜',
		category: 'efficiency',
		status: 'ready',
		keywords: ['scroll', 'smooth', 'gundong', '滚动'],
		features: { contentScript: true },
	},
	{
		id: 'screenshot',
		icon: '📸',
		category: 'efficiency',
		status: 'ready',
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
	{
		id: 'tabs',
		icon: '📑',
		category: 'efficiency',
		status: 'ready',
		keywords: ['tabs', 'manager', 'biaoqian', '标签', '切换', 'vertical'],
	},
];
