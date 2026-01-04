// goal: Tool Storage Utilities
// eff: Extracted from use-tool-manager.ts

import type { ToolPrefs } from '../core/tool-registry-types';
import { TOOL_PREFS_KEY } from '../registry/tool-registry';

import { safeStorageGet, safeStorageSet } from '../core/safe-storage';

// Load tool preferences from storage
export async function loadToolPrefs(): Promise<Record<string, ToolPrefs>> {
	const result = await safeStorageGet([TOOL_PREFS_KEY], { [TOOL_PREFS_KEY]: {} });
	return result[TOOL_PREFS_KEY] as Record<string, ToolPrefs>;
}

// Save tool preferences
export async function saveToolPrefs(prefs: Record<string, ToolPrefs>): Promise<void> {
	await safeStorageSet({ [TOOL_PREFS_KEY]: prefs });
}
