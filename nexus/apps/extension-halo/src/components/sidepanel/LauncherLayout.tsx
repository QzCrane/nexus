
// goal: Modern Mobile-style Launcher layout with slide transitions
import React, { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId } from '../../kernel/types';
import type { ToolCategory } from '../../i18n/types';
import { ToolPanelRenderer } from '../tool-panel-renderer';
import { SearchBar } from '../SearchBar';
import { commonStyles } from './layouts.styles';
import type { LayoutProps } from './types';

export const LauncherLayout: React.FC<LayoutProps & { onToggleMode: () => void }> = ({
    activeTool,
    onSelectTool,
    onBack,
    settings,
    onSettingsChange,
    visibleTools,
    onToggleMode
}) => {
    const { t } = useTranslation();
    const showLabels = settings?.showToolLabels ?? true;

    // Separate tools into categories, excluding system tools like module-store
    const { categorizedTools, systemTools } = useMemo(() => {
        const sys: typeof visibleTools = [];
        const cats: Record<ToolCategory, typeof visibleTools> = {
            general: [],
            dev: [],
            efficiency: [],
            visual: [],
            ai: []
        };

        visibleTools.forEach(tool => {
            if (tool.id === 'module-store' || tool.id === 'settings') {
                sys.push(tool);
            } else if (cats[tool.category]) {
                cats[tool.category].push(tool);
            } else {
                // Fallback for undefined categories
                cats.general.push(tool);
            }
        });

        return { categorizedTools: cats, systemTools: sys };
    }, [visibleTools]);

    const toggleLabels = () => {
        if (settings) {
            onSettingsChange({ ...settings, showToolLabels: !showLabels });
        }
    };

    const moduleStore = systemTools.find(t => t.id === 'module-store');

    return (
        <div style={commonStyles.container}>
            <div style={{
                display: 'flex',
                width: '200%',
                height: '100%',
                transform: activeTool ? 'translateX(-50%)' : 'translateX(0)',
                transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
            }}>
                {/* PAGE 1: HOME / LAUNCHER */}
                <div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <header style={commonStyles.header}>
                        <div style={commonStyles.headerContent}>
                            <span style={{ fontSize: '20px' }}>🌟</span>
                            <h1 style={commonStyles.title}>HALO</h1>
                        </div>
                        <div style={commonStyles.headerActions}>
                            <button 
                                style={{ ...commonStyles.iconBtn, fontSize: '12px', width: 'auto', padding: '0 6px' }} 
                                onClick={toggleLabels}
                                title={showLabels ? t('layout.hideLabels') : t('layout.showLabels')}
                            >
                                {showLabels ? '📝' : '✖️'}
                            </button>
                            <button 
                                style={commonStyles.iconBtn} 
                                onClick={onToggleMode}
                                title={t('layout.mode') + ': ' + t('layout.launcher')}
                            >
                                📱
                            </button>
                             {moduleStore && (
                                <button
                                    style={commonStyles.iconBtn}
                                    onClick={() => onSelectTool(moduleStore.id as ToolId)}
                                    title={t(`tools.${moduleStore.id}.name`)}
                                >
                                    {moduleStore.icon}
                                </button>
                             )}
                            <button 
                                style={commonStyles.iconBtn} 
                                onClick={() => onSelectTool('settings' as ToolId)}
                                title={t('common.settings')}
                            >
                                ⚙️
                            </button>
                        </div>
                    </header>
                    
                    <div style={{ padding: '0 12px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ margin: '12px 0' }}>
                           <SearchBar onSelect={(id) => onSelectTool(id as ToolId)} />
                        </div>

                        <div style={commonStyles.toolbar}>
                            {(Object.keys(categorizedTools) as ToolCategory[]).map(category => {
                                const tools = categorizedTools[category];
                                if (tools.length === 0) return null;

                                return (
                                    <div key={category} style={commonStyles.categorySection}>
                                        <div style={commonStyles.categoryTitle}>{t(`categories.${category}`)}</div>
                                        <div style={commonStyles.toolGrid}>
                                            {tools.map((tool) => {
                                                const isReady = tool.status === 'ready' || tool.status === 'beta';
                                                return (
                                                    <button
                                                        key={tool.id}
                                                        onClick={() => isReady && onSelectTool(tool.id as ToolId)}
                                                        disabled={!isReady}
                                                        style={{
                                                            ...commonStyles.toolBtn,
                                                            aspectRatio: '1/1',
                                                            height: 'auto',
                                                            opacity: isReady ? 1 : 0.4,
                                                            cursor: isReady ? 'pointer' : 'not-allowed',
                                                        }}
                                                        title={isReady ? t(`tools.${tool.id}.name`) : `${t(`tools.${tool.id}.name`)} (${t('common.comingSoon')})`}
                                                    >
                                                        <span style={commonStyles.toolIcon}>{tool.icon}</span>
                                                        {showLabels && (
                                                            <span style={commonStyles.toolLabel}>
                                                                {t(`tools.${tool.id}.name`)}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={commonStyles.footer}>
                        <span>🔒 {t('footer.zeroTracking')}</span>
                        <span>•</span>
                        <span>💾 {t('footer.localOnly')}</span>
                    </div>
                </div>

                {/* PAGE 2: TOOL VIEW */}
                <div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <header style={commonStyles.header}>
                        <div style={commonStyles.headerContent}>
                            <button 
                                style={{ ...commonStyles.iconBtn, width: 'auto', padding: '0 8px', gap: '4px' }}
                                onClick={onBack}
                                title={t('common.back')}
                            >
                                <span style={{ fontSize: '18px' }}>←</span>
                                <span style={{ fontSize: '14px', fontWeight: 500 }}>{t('common.back')}</span>
                            </button>
                        </div>
                        <div style={commonStyles.headerActions}>
                             <button 
                                style={commonStyles.iconBtn} 
                                onClick={() => onSelectTool('settings' as ToolId)}
                            >
                                ⚙️
                            </button>
                        </div>
                    </header>
                    <div style={commonStyles.content}>
                        <ToolPanelRenderer
                            activeTool={activeTool}
                            onSettingsChange={onSettingsChange}
                            selectToolText={t('common.selectTool')}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
