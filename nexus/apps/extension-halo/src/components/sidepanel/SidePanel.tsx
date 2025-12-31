
// goal: SidePanel container and state manager
// eff: Handles global state, mode switching, and initialization

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createLogger } from '@nexus/kernel';
import type { ToolId } from '../../kernel/types';
import { STORAGE_PREFIX } from '../../kernel/types';
import type { HaloSettings } from '../../kernel/settings';
import { loadSettings, getThemeColors, applyTheme } from '../../kernel/theme';
import { useModuleManager } from '../../kernel/use-module-manager';
import { useTranslation } from '../../i18n';
import { TOOL_REGISTRY } from '../../kernel/tools-data';
import { ClassicLayout } from './ClassicLayout';
import { LauncherLayout } from './LauncherLayout';

const logger = createLogger('SidePanel', 'HALO');
const VIEW_MODE_KEY = `${STORAGE_PREFIX.CORE}view_mode`;

export const SidePanel: React.FC = () => {
    const { t, ready: i18nReady } = useTranslation();
    const { isInstalled, loading: modulesLoading } = useModuleManager();
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);
    const [settings, setSettings] = useState<HaloSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'launcher' | 'classic'>('launcher');

    // Filter tools based on installed modules
    const visibleTools = useMemo(() => {
        if (modulesLoading) return TOOL_REGISTRY;
        // Check if tool is installed (if it's a module) or core (always true if not in module manager?)
        // The useModuleManager hook's isInstalled likely handles module IDs.
        // Assuming TOOL_REGISTRY ids match module ids.
        return TOOL_REGISTRY.filter((tool) => isInstalled(tool.id));
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

            const storage = await chrome.storage.sync.get([`${STORAGE_PREFIX.CORE}active_tool`]);
            const saved = storage[`${STORAGE_PREFIX.CORE}active_tool`] as ToolId | null;
            if (saved) setActiveTool(saved);
            
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
        await chrome.storage.sync.set({ [`${STORAGE_PREFIX.CORE}active_tool`]: toolId });
        logger.info('Tool activated:', toolId);
    }, []);

    const handleBack = useCallback(async () => {
        setActiveTool(null);
        await chrome.storage.sync.remove([`${STORAGE_PREFIX.CORE}active_tool`]);
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
