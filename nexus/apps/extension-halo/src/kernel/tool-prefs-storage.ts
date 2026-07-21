// goal: Tool preferences storage utilities
// eff: Load/save tool prefs from chrome.storage.local

import type { ToolPrefs } from './registry/tool-registry';
import { TOOL_PREFS_KEY } from './registry/tool-registry';

/** Load tool preferences from storage */
export async function loadToolPrefs(): Promise<Record<string, ToolPrefs>> {
	try {
		const result = await chrome.storage.local.get(TOOL_PREFS_KEY);
		return (result[TOOL_PREFS_KEY] as Record<string, ToolPrefs>) || {};
	} catch {
		return {};
	}
}

/** Save tool preferences */
export async function saveToolPrefs(prefs: Record<string, ToolPrefs>): Promise<void> {
	try {
		await chrome.storage.local.set({ [TOOL_PREFS_KEY]: prefs });
	} catch {
		// Ignore errors
	}
}
