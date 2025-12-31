
// goal: Classic "Toolbar Top + Content Bottom" layout
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId } from '../../kernel/types';
import { ToolPanelRenderer } from '../tool-panel-renderer';
import { commonStyles } from './layouts.styles';
import type { LayoutProps } from './types';

const MIN_HEIGHT_LABELS = 66; // Exact height for one row with labels (Icon+Text)
const MIN_HEIGHT_ICONS = 52;  // Exact height for one row with icons only

export const ClassicLayout: React.FC<LayoutProps & { onToggleMode: () => void }> = ({
    activeTool,
    onSelectTool,
    settings,
    onSettingsChange,
    visibleTools,
    onToggleMode
}) => {
    const { t } = useTranslation();
    const showLabels = settings?.showToolLabels ?? true;
    const accentColor = settings?.accentColor || '#7c3aed';
    const toolbarRef = useRef<HTMLDivElement>(null);

    // Resize logic
    const minHeight = showLabels ? MIN_HEIGHT_LABELS : MIN_HEIGHT_ICONS;
    const [toolbarHeight, setToolbarHeight] = useState(120);
    const isResizing = useRef(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isResizing.current = true;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }, []);

    useEffect(() => {
        // Enforce min constraint when mode changes
        if (toolbarHeight < minHeight) {
            setToolbarHeight(minHeight);
        }
    }, [showLabels, minHeight, toolbarHeight]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return;
            
            // Calculate max height based on actual content
            const contentHeight = toolbarRef.current?.scrollHeight || 1000;
            const maxWindowHeight = window.innerHeight * 0.7; // Hard limit 70%
            const effectiveMaxHeight = Math.min(contentHeight, maxWindowHeight);

            const newHeight = e.clientY - 44; // Subtract header height
            
            // "Elegant" clamping
            if (newHeight < minHeight) {
                setToolbarHeight(minHeight);
            } else if (newHeight > effectiveMaxHeight) {
                setToolbarHeight(effectiveMaxHeight);
            } else {
                setToolbarHeight(newHeight);
            }
        };

        const handleMouseUp = () => {
            isResizing.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = '';
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [minHeight]);

    const toggleLabels = () => {
        if (settings) {
            onSettingsChange({ ...settings, showToolLabels: !showLabels });
        }
    };

    const moduleStore = visibleTools.find(t => t.id === 'module-store');

    return (
        <div style={commonStyles.container}>
            <style>{`
                .halo-scrollbar {
                    scrollbar-gutter: stable;
                }
                .halo-scrollbar::-webkit-scrollbar {
                    width: 6px;
                    height: 6px;
                }
                .halo-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .halo-scrollbar::-webkit-scrollbar-thumb {
                    background: var(--halo-border, #444);
                    border-radius: 3px;
                }
                .halo-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: var(--halo-text-muted, #666);
                }
            `}</style>
            
            {/* Header */}
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
                        title={t('layout.mode') + ': ' + t('layout.classic')}
                    >
                        📑
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

            {/* Toolbar - Always visible in Classic Mode */}
            <div 
                ref={toolbarRef}
                className="halo-scrollbar"
                style={{
                ...commonStyles.toolbar,
                display: 'grid', // Ensure grid is used here specifically
                gridTemplateColumns: `repeat(auto-fill, minmax(${showLabels ? '80px' : '40px'}, 1fr))`,
                gridAutoRows: 'max-content',
                padding: '8px',
                flexShrink: 0,
                height: `${toolbarHeight}px`,
                borderBottom: 'none',
                gap: '4px',
                alignContent: 'start',
                overflowY: 'auto', // Allow scrolling
                transition: isResizing.current ? 'none' : 'height 0.2s cubic-bezier(0.2, 0, 0, 1)', // Smooth snap
            }}>
                {visibleTools.filter(t => t.id !== 'module-store' && t.id !== 'settings').map((tool) => {
                    const isReady = tool.status === 'ready' || tool.status === 'beta';
                    const isActive = activeTool === tool.id;
                    return (
                        <button
                            key={tool.id}
                            onClick={() => isReady && onSelectTool(tool.id as ToolId)}
                            disabled={!isReady}
                            style={{
                                ...commonStyles.toolBtn,
                                minHeight: showLabels ? 'auto' : '36px',
                                height: showLabels ? 'auto' : '36px', // Compact if no labels
                                flexShrink: 0, // Prevent flex shrinking
                                aspectRatio: showLabels ? 'auto' : '1/1',
                                padding: '4px',
                                background: isActive ? `${accentColor}20` : 'transparent',
                                borderColor: isActive ? accentColor : 'transparent',
                                opacity: isReady ? 1 : 0.4,
                                cursor: isReady ? 'pointer' : 'not-allowed',
                            }}
                            title={t(`tools.${tool.id}.name`)}
                        >
                            <span style={{ fontSize: '18px' }}>{tool.icon}</span>
                            {showLabels && (
                                <span style={{
                                    fontSize: '9px',
                                    marginTop: '2px',
                                    color: 'var(--halo-text-muted, #999)',
                                    width: '100%',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    textAlign: 'center'
                                }}>
                                    {t(`tools.${tool.id}.name`)}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            
            <div style={commonStyles.resizeHandle} onMouseDown={handleMouseDown}>
                <div style={commonStyles.resizeHandleIcon} />
            </div>

            {/* Content */}
            <div className="halo-scrollbar" style={{ ...commonStyles.content, overflowY: 'auto' }}>
                <ToolPanelRenderer
                    activeTool={activeTool}
                    onSettingsChange={onSettingsChange}
                    selectToolText={t('common.selectTool')}
                />
            </div>


             <div style={commonStyles.footer}>
                <span>🔒 {t('footer.zeroTracking')}</span>
                <span>•</span>
                <span>💾 {t('footer.localOnly')}</span>
            </div>
        </div>
    );
};
