// goal: Visual Tools Data
// eff: Split from tools-data.ts

import type { ToolMeta } from './tool-registry-types';

export const TOOLS_VISUAL: ToolMeta[] = [
	{
		id: 'pdf',
		icon: '📄',
		category: 'visual',
		status: 'ready',
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
];
