import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ToolId, HaloSettings } from '../../kernel';
import { STORAGE_PREFIX, loadSettings, getThemeColors, applyTheme, TOOL_REGISTRY, saveSettings } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { safeStorageGet, safeStorageSet, safeStorageRemove } from '../../kernel/core/safe-storage';

const OPEN_TOOLS_KEY = `${STORAGE_PREFIX.CORE}open_tools`;
const ACTIVE_TOOL_KEY = `${STORAGE_PREFIX.CORE}active_tool`;
const MAX_OPEN_TOOLS = 10;

export const useSidePanelState = () => {
	const { isInstalled, loading: modulesLoading } = useModuleManager();
	const [activeTool, setActiveTool] = useState<ToolId | null>(null);
	const [openTools, setOpenTools] = useState<ToolId[]>([]);
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [loading, setLoading] = useState(true);

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

			const storage = await safeStorageGet<Record<string, unknown>>([ACTIVE_TOOL_KEY, OPEN_TOOLS_KEY], {});
			const savedOpen = (storage[OPEN_TOOLS_KEY] as ToolId[] || []).filter(id => isInstalled(id));

			if (savedOpen.length > 0) {
				setOpenTools(savedOpen);
				const savedActive = storage[ACTIVE_TOOL_KEY] as ToolId | null;
				if (savedActive && (savedOpen.includes(savedActive) || savedActive === 'settings' || savedActive === 'module-store' || savedActive === 'permissions')) {
					setActiveTool(savedActive);
				} else {
					setActiveTool(savedOpen[savedOpen.length - 1]);
				}
			}
			setLoading(false);
		};
		init();

		const listener = (message: any, _sender: any, _sendResponse: any) => {
			if (message.type === 'HALO_ACTIVATE_TOOL' && message.toolId) {
				handleToolSelect(message.toolId);
			}
			return true; // Keep channel open
		};
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, [isInstalled]);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		const tool = TOOL_REGISTRY.find(t => t.id === toolId);
		if (tool?.status === 'coming') return;

		setActiveTool(toolId);
		if (toolId !== 'module-store' && toolId !== 'settings' && toolId !== 'permissions') {
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
			if (activeTool === toolId) {
				const next = newOpen.length > 0 ? newOpen[newOpen.length - 1] : null;
				setActiveTool(next);
				if (next) safeStorageSet({ [ACTIVE_TOOL_KEY]: next });
				else safeStorageRemove([ACTIVE_TOOL_KEY]);
			}
			safeStorageSet({ [OPEN_TOOLS_KEY]: newOpen });
			return newOpen;
		});
	}, [activeTool]);

	const handleBack = useCallback(async () => {
		setActiveTool(null);
		await safeStorageRemove([ACTIVE_TOOL_KEY]);
	}, []);

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
