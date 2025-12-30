// goal: Clipboard tool type definitions

export interface ClipboardItem {
	id: string;
	text: string;
	timestamp: number;
	pinned: boolean;
	sourceUrl?: string;
	sourceTitle?: string;
}

export const STORAGE_KEY = 'halo_tool_clipboard_history';
export const MAX_HISTORY = 100;
