// goal: Tool Storage Utilities
// eff: Extracted from use-tool-manager.ts

import type { ToolPrefs } from '../core/tool-registry-types';
import { TOOL_PREFS_KEY } from '../registry/tool-registry';

// Load tool preferences from storage
export async function loadToolPrefs(): Promise<Record<string, ToolPrefs>> {
	try {
		const result = await chrome.storage.local.get(TOOL_PREFS_KEY);
		return (result[TOOL_PREFS_KEY] as Record<string, ToolPrefs>) || {};
	} catch (error: unknown) {
		console.error('[HALO:ToolPrefs] Failed to load preferences', error);
		return {};
	}
}

// Save tool preferences
export async function saveToolPrefs(prefs: Record<string, ToolPrefs>): Promise<void> {
	try {
		await chrome.storage.local.set({ [TOOL_PREFS_KEY]: prefs });
	} catch (error: unknown) {
		console.error('[HALO:ToolPrefs] Failed to persist preferences', error);
	}
}
