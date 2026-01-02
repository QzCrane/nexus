// goal: SidePanel context for centralized state management
// eff: Eliminates prop drilling through component hierarchy

import React, { createContext, useContext } from 'react';
import type { ToolId, HaloSettings, ToolMeta } from '../../kernel';

export interface SidePanelContextValue {
	// State
	activeTool: ToolId | null;
	openTools: ToolId[];
	settings: HaloSettings | null;
	visibleTools: ToolMeta[];
	loading: boolean;
	modulesLoading: boolean;
	
	// Actions
	handleToolSelect: (toolId: ToolId) => Promise<void>;
	handleCloseTool: (toolId: ToolId) => void;
	handleBack: () => Promise<void>;
	handleSettingsChange: (settings: HaloSettings) => Promise<void>;
	handleTogglePin: (toolId: string) => void;
	handleReorderTools: (category: string, toolIds: string[]) => void;
	handleReorderCategories: (categoryIds: string[]) => void;
}

const SidePanelContext = createContext<SidePanelContextValue | null>(null);

export const SidePanelProvider = SidePanelContext.Provider;

/**
 * Hook to consume SidePanel state and actions
 * @throws Error if used outside SidePanelProvider
 */
export function useSidePanel(): SidePanelContextValue {
	const ctx = useContext(SidePanelContext);
	if (!ctx) {
		throw new Error('useSidePanel must be used within SidePanelProvider');
	}
	return ctx;
}

/**
 * Hook to get only the active tool state (minimal re-renders)
 */
export function useActiveTool(): ToolId | null {
	const { activeTool } = useSidePanel();
	return activeTool;
}

/**
 * Hook to get tool actions only
 */
export function useToolActions() {
	const { handleToolSelect, handleCloseTool, handleBack } = useSidePanel();
	return { handleToolSelect, handleCloseTool, handleBack };
}
