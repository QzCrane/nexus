// goal: Clipboard tool type definitions

export interface ClipboardItem {
	id: string;
	text: string;
	timestamp: number;
	pinned: boolean;
	sourceUrl?: string;
	sourceTitle?: string;
}

export interface ClipboardSettings {
	enabled: boolean;
}

export const DEFAULT_CLIPBOARD_SETTINGS: Readonly<ClipboardSettings> = Object.freeze({
	enabled: false,
});

/**
 * The unavailable Clipboard surface is fail-closed in every realm. This parser
 * is the sole missing/malformed-storage policy for the Content host, panel and
 * runtime-status projection.
 */
export function parseClipboardSettings(value: unknown): ClipboardSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ...DEFAULT_CLIPBOARD_SETTINGS };
	}
	const enabled = (value as Record<string, unknown>).enabled;
	return { enabled: typeof enabled === 'boolean' ? enabled : false };
}

export const STORAGE_KEY = 'halo_tool_clipboard_history';
export const SETTINGS_STORAGE_KEY = 'halo_tool_clipboard_settings';
export const MAX_HISTORY = 100;
