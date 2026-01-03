// goal: Open tools state management hook
// eff: Extracted from use-sidepanel-state.ts for better modularity

import { useState, useCallback } from 'react';
import type { ToolId } from '../../../kernel';
import { STORAGE_PREFIX } from '../../../kernel';
import { safeStorageGet, safeStorageSet, safeStorageRemove } from '../../../kernel/core/safe-storage';

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
			// System tools can be active without being in openTools
			const isSystemTool = (id: string) =>
				id === 'settings' || id === 'module-store' || id === 'permissions' || id === 'extension-manager';
			if (savedActive && (savedOpen.includes(savedActive) || isSystemTool(savedActive))) {
				setActiveToolState(savedActive);
			} else {
				setActiveToolState(savedOpen[savedOpen.length - 1]);
			}
		}
	}, []);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		setActiveToolState(toolId);

		// System tools don't get added to dock
		const isSystemTool = toolId === 'module-store' || toolId === 'settings' || toolId === 'permissions' || toolId === 'extension-manager';
		if (!isSystemTool) {
			setOpenTools(prev => {
				if (prev.includes(toolId)) return prev;
				const newOpen = prev.length >= MAX_OPEN_TOOLS ? [...prev.slice(1), toolId] : [...prev, toolId];
				safeStorageSet({ [OPEN_TOOLS_KEY]: newOpen });
				return newOpen;
			});
		}
		await safeStorageSet({ [ACTIVE_TOOL_KEY]: toolId });
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
