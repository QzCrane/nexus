// goal: Open tools state management hook
// eff: Extracted from use-sidepanel-state.ts for better modularity

import { useState, useCallback } from 'react';
import type { ToolId } from '../../../kernel';
import { STORAGE_PREFIX, TOOL_REGISTRY } from '../../../kernel';
import { safeStorageGet, safeStorageSet, safeStorageRemove } from '../../../kernel/core/safe-storage';

// Dynamic system tool checker from registry (SSOT)
const isSystemTool = (id: string): boolean => {
	const tool = TOOL_REGISTRY.find(t => t.id === id);
	return tool?.system === true;
};

const OPEN_TOOLS_KEY = `${STORAGE_PREFIX.CORE}open_tools`;
const ACTIVE_TOOL_KEY = `${STORAGE_PREFIX.CORE}active_tool`;
const MAX_OPEN_TOOLS = 10;

export interface UseOpenToolsResult {
	activeTool: ToolId | null;
	openTools: ToolId[];
	setActiveTool: (toolId: ToolId | null) => void;
	handleToolSelect: (toolId: ToolId) => Promise<void>;
	handleCloseTool: (toolId: ToolId) => void;
	handleBack: () => Promise<void>;
	loadOpenTools: (isInstalled: (id: string) => boolean) => Promise<void>;
}

export function useOpenTools(): UseOpenToolsResult {
	const [activeTool, setActiveToolState] = useState<ToolId | null>(null);
	const [openTools, setOpenTools] = useState<ToolId[]>([]);

	const setActiveTool = useCallback((toolId: ToolId | null) => {
		setActiveToolState(toolId);
	}, []);

	const loadOpenTools = useCallback(async (isInstalled: (id: string) => boolean) => {
		const storage = await safeStorageGet<Record<string, unknown>>([ACTIVE_TOOL_KEY, OPEN_TOOLS_KEY], {});
		const savedOpen = (storage[OPEN_TOOLS_KEY] as ToolId[] || []).filter(id => isInstalled(id));

		if (savedOpen.length > 0) {
			setOpenTools(savedOpen);
			const savedActive = storage[ACTIVE_TOOL_KEY] as ToolId | null;
			// System tools are ephemeral - don't restore them on load
			if (savedActive && savedOpen.includes(savedActive) && !isSystemTool(savedActive)) {
				setActiveToolState(savedActive);
			} else {
				// Fall back to last non-system tool or null (home page)
				const lastUserTool = savedOpen.filter(id => !isSystemTool(id)).pop();
				setActiveToolState(lastUserTool || null);
			}
		}
		// Clear any stale system tool from storage on load
		await safeStorageRemove([ACTIVE_TOOL_KEY]);
	}, []);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		setActiveToolState(toolId);

		// System tools: ephemeral, don't add to dock or persist activeTool
		const isSys = isSystemTool(toolId);
		if (!isSys) {
			setOpenTools(prev => {
				if (prev.includes(toolId)) return prev;
				const newOpen = prev.length >= MAX_OPEN_TOOLS ? [...prev.slice(1), toolId] : [...prev, toolId];
				safeStorageSet({ [OPEN_TOOLS_KEY]: newOpen });
				return newOpen;
			});
			// Only persist activeTool for user tools
			await safeStorageSet({ [ACTIVE_TOOL_KEY]: toolId });
		}
		// System tools don't persist - will return to home on next open
	}, []);

	const handleCloseTool = useCallback((toolId: ToolId) => {
		setOpenTools(prev => {
			const newOpen = prev.filter(id => id !== toolId);

			// If closing active tool, switch to last open
			setActiveToolState(current => {
				if (current === toolId) {
					const next = newOpen.length > 0 ? newOpen[newOpen.length - 1] : null;
					if (next) safeStorageSet({ [ACTIVE_TOOL_KEY]: next });
					else safeStorageRemove([ACTIVE_TOOL_KEY]);
					return next;
				}
				return current;
			});

			safeStorageSet({ [OPEN_TOOLS_KEY]: newOpen });
			return newOpen;
		});
	}, []);

	const handleBack = useCallback(async () => {
		setActiveToolState(null);
		await safeStorageRemove([ACTIVE_TOOL_KEY]);
	}, []);

	return {
		activeTool,
		openTools,
		setActiveTool,
		handleToolSelect,
		handleCloseTool,
		handleBack,
		loadOpenTools,
	};
}
