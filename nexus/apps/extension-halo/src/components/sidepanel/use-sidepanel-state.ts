// goal: SidePanel state management
// eff: Delegates open tools logic to useOpenTools hook

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ToolId, HaloSettings } from '../../kernel';
import { loadSettings, getThemeColors, applyTheme, TOOL_REGISTRY, saveSettings } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { useOpenTools } from './hooks/use-open-tools';

function isToolId(value: unknown): value is ToolId {
	return typeof value === 'string'
		&& TOOL_REGISTRY.some(tool => tool.id === value);
}

export const useSidePanelState = () => {
	const { isInstalled, loading: modulesLoading } = useModuleManager();
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [settingsLoading, setSettingsLoading] = useState(true);
	const [openToolsLoading, setOpenToolsLoading] = useState(true);

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
				status: tool.status === 'available' ? 'ready' : tool.status
			}));
	}, [modulesLoading, isInstalled]);

	// Settings/theme are independent of module-manager hydration. Load them once
	// per SidePanel mount instead of repeating the storage read when
	// modulesLoading flips from true to false.
	useEffect(() => {
		let mounted = true;
		void loadSettings().then((loadedSettings) => {
			if (!mounted) return;
			setSettings(loadedSettings);
			applyTheme(getThemeColors(loadedSettings.theme, loadedSettings.accentColor));
		}).catch((error: unknown) => {
			console.error('[HALO:SidePanel] settings init failed', error);
		}).finally(() => {
			if (mounted) setSettingsLoading(false);
		});
		return () => { mounted = false; };
	}, []);

	// Open-tool restoration is the only initialization phase that must wait for
	// the module manager, because it validates persisted tools against the live
	// installation set.
	useEffect(() => {
		if (modulesLoading) {
			setOpenToolsLoading(true);
			return;
		}
		let mounted = true;
		void loadOpenTools(isInstalled).catch((error: unknown) => {
			console.error('[HALO:SidePanel] open-tools init failed', error);
		}).finally(() => {
			if (mounted) setOpenToolsLoading(false);
		});
		return () => { mounted = false; };
	}, [modulesLoading, isInstalled, loadOpenTools]);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		const tool = TOOL_REGISTRY.find(t => t.id === toolId);
		if (tool?.status === 'coming') return;
		await baseToolSelect(toolId);
	}, [baseToolSelect]);

	const listener = useCallback((message: unknown) => {
		if (
			typeof message === 'object'
			&& message !== null
			&& 'type' in message
			&& message.type === 'HALO_ACTIVATE_TOOL'
			&& 'toolId' in message
			&& isToolId(message.toolId)
		) {
			void handleToolSelect(message.toolId).catch((error: unknown) => {
				console.error('[HALO:SidePanel] Failed to activate tool', error);
			});
		}
		return false;
	}, [handleToolSelect]);

	useEffect(() => {
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, [listener]);

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
		loading: settingsLoading || openToolsLoading,
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
