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
/**
 * Encoded history ceiling for the whole list. Pinned entries are never evicted
 * to admit new text; when pinned entries alone exceed this budget admission
 * fails explicitly instead of silently dropping pinned data.
 */
export const MAX_HISTORY_BYTES = 512 * 1024;

/**
 * Sole missing/malformed-storage policy for the history list. Entries that do
 * not satisfy the domain contract are dropped, never shape-coerced: a stored
 * entry survives with all its fields or not at all.
 */
export function parseClipboardHistory(value: unknown): ClipboardItem[] {
	if (!Array.isArray(value)) return [];
	const parsed: ClipboardItem[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
		const item = entry as Record<string, unknown>;
		if (typeof item.id !== 'string' || item.id.length === 0) continue;
		if (typeof item.text !== 'string') continue;
		if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) continue;
		parsed.push({
			id: item.id,
			text: item.text,
			timestamp: item.timestamp,
			pinned: item.pinned === true,
			...(typeof item.sourceUrl === 'string' ? { sourceUrl: item.sourceUrl } : {}),
			...(typeof item.sourceTitle === 'string' ? { sourceTitle: item.sourceTitle } : {}),
		});
	}
	return parsed;
}

export function clipboardHistoryBytes(history: ClipboardItem[]): number {
	return new TextEncoder().encode(JSON.stringify(history)).byteLength;
}
