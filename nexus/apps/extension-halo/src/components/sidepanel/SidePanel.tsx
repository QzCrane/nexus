// goal: SidePanel container and state manager
// eff: Handles global state and initialization (Launcher Mode Only)

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createLogger } from '@nexus/kernel';
import type { ToolId } from '../../kernel';
import { STORAGE_PREFIX } from '../../kernel';
import type { HaloSettings } from '../../kernel';
import { loadSettings, getThemeColors, applyTheme } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { useTranslation } from '../../i18n';
import { TOOL_REGISTRY } from '../../kernel';
import { LauncherLayout } from './LauncherLayout';

const logger = createLogger('SidePanel', 'HALO');
const OPEN_TOOLS_KEY = `${STORAGE_PREFIX.CORE}open_tools`;
const ACTIVE_TOOL_KEY = `${STORAGE_PREFIX.CORE}active_tool`;
const MAX_OPEN_TOOLS = 10; // Prevent memory exhaustion

export const SidePanel: React.FC = () => {
	const { t, ready: i18nReady } = useTranslation();
	const { isInstalled, loading: modulesLoading } = useModuleManager();
	const [activeTool, setActiveTool] = useState<ToolId | null>(null);
	const [openTools, setOpenTools] = useState<ToolId[]>([]);
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [loading, setLoading] = useState(true);

	// Filter tools based on installed modules
	const visibleTools = useMemo(() => {
		if (modulesLoading) return TOOL_REGISTRY;
		return TOOL_REGISTRY
			.filter((tool) => isInstalled(tool.id))
			.map(tool => ({
				...tool,
				status: tool.status === 'available' ? 'ready' : tool.status
			}));
	}, [modulesLoading, isInstalled]);

	useEffect(() => {
		const init = async () => {
			const s = await loadSettings();
			setSettings(s);
			const colors = getThemeColors(s.theme, s.accentColor);
			applyTheme(colors);

			// Restore open tools and active tool
			const storage = await chrome.storage.sync.get([ACTIVE_TOOL_KEY, OPEN_TOOLS_KEY]);
			const savedActive = storage[ACTIVE_TOOL_KEY] as ToolId | null;
			const savedOpen = (storage[OPEN_TOOLS_KEY] as ToolId[] || []).filter(id => isInstalled(id));
			
			if (savedOpen.length > 0) {
				setOpenTools(savedOpen);
				// Restore active tool (must be in openTools)
				if (savedActive && savedOpen.includes(savedActive)) {
					setActiveTool(savedActive);
				} else {
					setActiveTool(savedOpen[savedOpen.length - 1]);
				}
			}
			
			setLoading(false);
		};
		init();

		const listener = (message: { type: string; toolId?: ToolId }): boolean | undefined => {
			if (message.type === 'HALO_ACTIVATE_TOOL' && message.toolId) {
				const toolId = message.toolId;
				setActiveTool(toolId);
				setOpenTools(prev => {
					if (prev.includes(toolId)) return prev;
					const newOpen = prev.length >= MAX_OPEN_TOOLS 
						? [...prev.slice(1), toolId] 
						: [...prev, toolId];
					chrome.storage.sync.set({ [OPEN_TOOLS_KEY]: newOpen });
					return newOpen;
				});
				chrome.storage.sync.set({ [ACTIVE_TOOL_KEY]: toolId });
			}
			return undefined;
		};
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, [isInstalled]); // Add isInstalled to dep array to re-filter if needed

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		const tool = TOOL_REGISTRY.find(t => t.id === toolId);
		if (tool && tool.status === 'coming') return;

		setActiveTool(toolId);
		setOpenTools(prev => {
			if (prev.includes(toolId)) return prev;
			const newOpen = prev.length >= MAX_OPEN_TOOLS 
				? [...prev.slice(1), toolId]
				: [...prev, toolId];
			chrome.storage.sync.set({ [OPEN_TOOLS_KEY]: newOpen });
			return newOpen;
		});
		await chrome.storage.sync.set({ [ACTIVE_TOOL_KEY]: toolId });
		logger.info('Tool activated:', toolId);
	}, []);

	const handleCloseTool = useCallback((toolId: ToolId) => {
		setOpenTools(prev => {
			const newOpen = prev.filter(id => id !== toolId);
			if (activeTool === toolId) {
				const next = newOpen.length > 0 ? newOpen[newOpen.length - 1] : null;
				setActiveTool(next);
				if (next) chrome.storage.sync.set({ [ACTIVE_TOOL_KEY]: next });
				else chrome.storage.sync.remove([ACTIVE_TOOL_KEY]);
			}
			chrome.storage.sync.set({ [OPEN_TOOLS_KEY]: newOpen });
			return newOpen;
		});
	}, [activeTool]);

	const handleBack = useCallback(async () => {
		setActiveTool(null);
		await chrome.storage.sync.remove([ACTIVE_TOOL_KEY]);
	}, []);

	const handleSettingsChange = useCallback((updated: HaloSettings) => {
		setSettings(updated);
		const colors = getThemeColors(updated.theme, updated.accentColor);
		applyTheme(colors);
	}, []);

	if (loading || !i18nReady || modulesLoading) {
		return (
			<div style={{
				display: 'flex', flexDirection: 'column', alignItems: 'center', 
				justifyContent: 'center', height: '100vh', 
				background: 'var(--halo-bg, #1a1a1a)', color: 'var(--halo-text-secondary, #888)'
			}}>
				<span style={{ fontSize: '24px', marginBottom: '8px' }}>🌟</span>
				<span>{t('common.loading')}</span>
			</div>
		);
	}

	return (
		<LauncherLayout
			activeTool={activeTool}
			openTools={openTools || []} // Safety fallback
			onCloseTool={handleCloseTool}
			onSelectTool={handleToolSelect}
			onBack={handleBack}
			settings={settings}
			onSettingsChange={handleSettingsChange}
			visibleTools={visibleTools}
		/>
	);
};
