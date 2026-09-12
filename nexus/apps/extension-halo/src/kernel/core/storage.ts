// goal: HALO storage helpers for chrome.storage
// Provides typed wrappers for common storage operations

import { STORAGE_PREFIX, type ToolId } from './types';

// Key builders
export const KEYS = {
	activeTool: () => `${STORAGE_PREFIX.CORE}active_tool`,
	toolState: (id: ToolId) => `${STORAGE_PREFIX.TOOL}${id}_state`,
	toolData: (id: ToolId, key: string) => `${STORAGE_PREFIX.TOOL}${id}_${key}`,
} as const;

// Hostname utilities for content scripts
export function getCurrentHostname(): string {
	try { return window.location.hostname; } catch { return ''; }
}
