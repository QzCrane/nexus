// goal: HALO storage helpers for chrome.storage
// Provides typed wrappers for common storage operations

import { STORAGE_PREFIX, type ToolId, type ToolState } from './types';

// Key builders
export const KEYS = {
	activeTool: () => `${STORAGE_PREFIX.CORE}active_tool`,
	toolState: (id: ToolId) => `${STORAGE_PREFIX.TOOL}${id}_state`,
	toolData: (id: ToolId, key: string) => `${STORAGE_PREFIX.TOOL}${id}_${key}`,
} as const;

// Generic storage operations
export async function getStorage<T>(key: string, fallback: T): Promise<T> {
	const result = await chrome.storage.sync.get([key]);
	return (result[key] as T) ?? fallback;
}

export async function setStorage<T>(key: string, value: T): Promise<void> {
	await chrome.storage.sync.set({ [key]: value });
}

// Tool-specific helpers
export async function getActiveTool(): Promise<ToolId | null> {
	return getStorage(KEYS.activeTool(), null);
}

export async function setActiveTool(toolId: ToolId | null): Promise<void> {
	await setStorage(KEYS.activeTool(), toolId);
}

export async function getToolState(id: ToolId): Promise<ToolState> {
	return getStorage(KEYS.toolState(id), { enabled: false });
}

export async function setToolState(id: ToolId, state: Partial<ToolState>): Promise<void> {
	const current = await getToolState(id);
	await setStorage(KEYS.toolState(id), { ...current, ...state });
}

// Hostname utilities for content scripts
export function getCurrentHostname(): string {
	try { return window.location.hostname; } catch { return ''; }
}
