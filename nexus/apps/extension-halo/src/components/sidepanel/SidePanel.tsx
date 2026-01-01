
// goal: SidePanel container and state manager
// eff: Handles global state, mode switching, and initialization

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createLogger } from '@nexus/kernel';
import type { ToolId } from '../../kernel';
import { STORAGE_PREFIX } from '../../kernel';
import type { HaloSettings } from '../../kernel';
import { loadSettings, getThemeColors, applyTheme } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { useTranslation } from '../../i18n';
import { TOOL_REGISTRY } from '../../kernel';
import { ClassicLayout } from './ClassicLayout';
import { LauncherLayout } from './LauncherLayout';

const logger = createLogger('SidePanel', 'HALO');
const VIEW_MODE_KEY = `${STORAGE_PREFIX.CORE}view_mode`;
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
    const [viewMode, setViewMode] = useState<'launcher' | 'classic'>('launcher');

    // Filter tools based on installed modules
    const visibleTools = useMemo(() => {
        if (modulesLoading) return TOOL_REGISTRY;
        // Check if tool is installed (if it's a module) or core (always true if not in module manager?)
        // The useModuleManager hook's isInstalled likely handles module IDs.
        // Assuming TOOL_REGISTRY ids match module ids.
        return TOOL_REGISTRY
            .filter((tool) => isInstalled(tool.id))
            .map(tool => ({
                ...tool,
                status: tool.status === 'available' ? 'ready' : tool.status
            }));
    }, [modulesLoading, isInstalled]);

    useEffect(() => {
        const init = async () => {
            const [s, modeData] = await Promise.all([
                loadSettings(),
                chrome.storage.sync.get([VIEW_MODE_KEY])
            ]);
            
            setSettings(s);
            const colors = getThemeColors(s.theme, s.accentColor);
            applyTheme(colors);

            if (modeData[VIEW_MODE_KEY]) {
                setViewMode(modeData[VIEW_MODE_KEY] as 'launcher' | 'classic');
            }

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
                setActiveTool(message.toolId);
            }
            return undefined;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    const handleToolSelect = useCallback(async (toolId: ToolId) => {
        // Only allow ready tools used to be checked in UI, checked here for safety
        const tool = TOOL_REGISTRY.find(t => t.id === toolId);
        if (tool && tool.status === 'coming') return;

        setActiveTool(toolId);
        setOpenTools(prev => {
            if (prev.includes(toolId)) return prev;
            // Enforce max open tools limit
            const newOpen = prev.length >= MAX_OPEN_TOOLS 
                ? [...prev.slice(1), toolId]  // Remove oldest
                : [...prev, toolId];
            // Persist
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
                // If closing active tool, switch to last used or null
                const next = newOpen.length > 0 ? newOpen[newOpen.length - 1] : null;
                setActiveTool(next);
                if (next) chrome.storage.sync.set({ [ACTIVE_TOOL_KEY]: next });
                else chrome.storage.sync.remove([ACTIVE_TOOL_KEY]);
            }
            // Persist
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

    const toggleMode = useCallback(async () => {
        const newMode = viewMode === 'launcher' ? 'classic' : 'launcher';
        setViewMode(newMode);
        await chrome.storage.sync.set({ [VIEW_MODE_KEY]: newMode });
        
        // If switching to launcher, clear active tool to show the grid
        if (newMode === 'launcher') {
            setActiveTool(null);
            await chrome.storage.sync.remove([`${STORAGE_PREFIX.CORE}active_tool`]);
        }
    }, [viewMode]);

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

    const commonProps = {
        activeTool,
        openTools,
        onCloseTool: handleCloseTool,
        onSelectTool: handleToolSelect,
        onBack: handleBack,
        settings,
        onSettingsChange: handleSettingsChange,
        visibleTools,
        i18nReady
    };

    if (viewMode === 'classic') {
        return <ClassicLayout {...commonProps} onToggleMode={toggleMode} />;
    }

    return <LauncherLayout {...commonProps} onToggleMode={toggleMode} />;
};
