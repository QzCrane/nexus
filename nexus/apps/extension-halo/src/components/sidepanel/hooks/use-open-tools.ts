// goal: Open tools state management hook
// eff: Simple state persistence - save on close, restore on open
// 
// Design: 
// 1. Save activeTool when sidepanel closes (visibilitychange/beforeunload)
// 2. Restore activeTool when sidepanel opens
// 3. System tools don't go into dock, but activeTool is tracked

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ToolId } from '../../../kernel';
import { STORAGE_PREFIX, TOOL_REGISTRY } from '../../../kernel';

// System tools list (SSOT from registry)
const SYSTEM_TOOL_IDS = TOOL_REGISTRY.filter(t => t.pluginType === 'system').map(t => t.id);

const isSystemTool = (id: string): boolean => SYSTEM_TOOL_IDS.includes(id);

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

	// Ref for unload save (avoids stale closure)
	const activeToolRef = useRef<ToolId | null>(null);
	const initialized = useRef(false);

	// Real-time persistence for activeTool
	useEffect(() => {
		// Prevent saving initial null state before storage load
		if (!initialized.current) return;

		if (activeTool !== null) {
			chrome.storage.local.set({ [ACTIVE_TOOL_KEY]: activeTool });
		} else {
			chrome.storage.local.remove([ACTIVE_TOOL_KEY]);
		}
	}, [activeTool]);

	const setActiveTool = useCallback((toolId: ToolId | null) => {
		setActiveToolState(toolId);
	}, []);

	const loadOpenTools = useCallback(async (isInstalled: (id: string) => boolean) => {
		const storage = await chrome.storage.local.get([ACTIVE_TOOL_KEY, OPEN_TOOLS_KEY]);
		const savedOpen = (storage[OPEN_TOOLS_KEY] as ToolId[] || []).filter(id => isInstalled(id));
		setOpenTools(savedOpen);

		// Restore activeTool (any tool is valid - system tools are always available)
		const savedActive = storage[ACTIVE_TOOL_KEY] as ToolId | null;
		if (savedActive) {
			// System tool: always valid. User tool: must be installed.
			const isValid = isSystemTool(savedActive) || isInstalled(savedActive);
			if (isValid) {
				setActiveToolState(savedActive);
				return;
			}
		}
		// Fallback: home page
		setActiveToolState(null);

		// Mark as initialized to enable auto-save
		setTimeout(() => { initialized.current = true; }, 0);
	}, []);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		setActiveToolState(toolId);

		// System tools don't go into dock
		if (!isSystemTool(toolId)) {
			setOpenTools(prev => {
				if (prev.includes(toolId)) return prev;
				const newOpen = prev.length >= MAX_OPEN_TOOLS ? [...prev.slice(1), toolId] : [...prev, toolId];
				chrome.storage.local.set({ [OPEN_TOOLS_KEY]: newOpen });
				return newOpen;
			});
		}
	}, []);

	const handleCloseTool = useCallback((toolId: ToolId) => {
		setOpenTools(prev => {
			const newOpen = prev.filter(id => id !== toolId);
			setActiveToolState(current => {
				if (current === toolId) {
					// When closing active tool, find next non-system tool to activate
					// If no non-system tools remain, go back to home (null)
					const nextUserTool = [...newOpen].reverse().find(id => !isSystemTool(id));
					return nextUserTool ?? null;
				}
				return current;
			});
			chrome.storage.local.set({ [OPEN_TOOLS_KEY]: newOpen });
			return newOpen;
		});
	}, []);

	const handleBack = useCallback(async () => {
		setActiveToolState(null);
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
