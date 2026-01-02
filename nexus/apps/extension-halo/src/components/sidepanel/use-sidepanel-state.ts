// goal: SidePanel state management
// eff: Delegates open tools logic to useOpenTools hook

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ToolId, HaloSettings } from '../../kernel';
import { loadSettings, getThemeColors, applyTheme, TOOL_REGISTRY, saveSettings } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { useOpenTools } from './hooks/use-open-tools';

export const useSidePanelState = () => {
	const { isInstalled, loading: modulesLoading } = useModuleManager();
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [loading, setLoading] = useState(true);

	const {
		activeTool,
		openTools,
		handleToolSelect: baseToolSelect,
		handleCloseTool,
		handleBack,
		loadOpenTools,
	} = useOpenTools();

	const visibleTools = useMemo(() => {
		if (modulesLoading) return TOOL_REGISTRY;
		return TOOL_REGISTRY
			.filter((tool) => isInstalled(tool.id))
			.map(tool => ({
				...tool,
				status: tool.status === 'available' ? 'ready' : (tool.status as any)
			}));
	}, [modulesLoading, isInstalled]);

	useEffect(() => {
		const init = async () => {
			const s = await loadSettings();
			setSettings(s);
			applyTheme(getThemeColors(s.theme, s.accentColor));
			await loadOpenTools(isInstalled);
			setLoading(false);
		};
		init();

		const listener = (message: any, _sender: any, _sendResponse: any) => {
			if (message.type === 'HALO_ACTIVATE_TOOL' && message.toolId) {
				handleToolSelect(message.toolId);
			}
			return true;
		};
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, [isInstalled, loadOpenTools]);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		const tool = TOOL_REGISTRY.find(t => t.id === toolId);
		if (tool?.status === 'coming') return;
		await baseToolSelect(toolId);
	}, [baseToolSelect]);

	const handleSettingsChange = useCallback(async (updated: HaloSettings) => {
		setSettings(updated);
		applyTheme(getThemeColors(updated.theme, updated.accentColor));
		await saveSettings(updated);
	}, []);

	const handleTogglePin = useCallback((toolId: string) => {
		if (!settings) return;
		const pinned = [...(settings.pinnedTools || [])];
		const index = pinned.indexOf(toolId);
		if (index >= 0) {
			pinned.splice(index, 1);
		} else {
			pinned.push(toolId);
		}
		handleSettingsChange({ ...settings, pinnedTools: pinned });
	}, [settings, handleSettingsChange]);

	const handleReorderTools = useCallback((category: string, toolIds: string[]) => {
		if (!settings) return;
		const newOrder = { ...(settings.toolOrder || {}), [category]: toolIds };
		handleSettingsChange({ ...settings, toolOrder: newOrder });
	}, [settings, handleSettingsChange]);

	const handleReorderCategories = useCallback((categoryIds: string[]) => {
		if (!settings) return;
		handleSettingsChange({ ...settings, categoryOrder: categoryIds });
	}, [settings, handleSettingsChange]);

	return {
		loading,
		modulesLoading,
		activeTool,
		openTools,
		settings,
		visibleTools,
		handleToolSelect,
		handleCloseTool,
		handleBack,
		handleSettingsChange,
		handleTogglePin,
		handleReorderTools,
		handleReorderCategories
	};
};

