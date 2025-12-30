// goal: Types for tool registry
// eff: Split types

import type { ToolCategory } from '../i18n/types';

export type ToolStatus = 'ready' | 'beta' | 'coming' | 'disabled';

export interface ToolMeta {
	id: string;
	icon: string;
	category: ToolCategory;
	status: ToolStatus;
	keywords: string[];
	features?: {
		contextMenu?: boolean;
		contentScript?: boolean;
		offscreen?: boolean;
	};
}

export interface ToolPrefs {
	enabled: boolean;
	pinned: boolean;
	usageCount: number;
	lastUsed?: number;
}
