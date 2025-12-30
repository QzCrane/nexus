
// goal: Tab Manager UI
// scope: module

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { TabItem, TabFilter } from './types';
import { getTabs, activateTab, closeTab, setupTabListeners } from './core';

const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        minHeight: '400px',
    },
    filterBar: {
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
    },
    filterChip: {
        padding: '4px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        cursor: 'pointer',
        border: '1px solid var(--halo-border, #444)',
        background: 'transparent',
        color: 'var(--halo-text-muted, #888)',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
    },
    filterChipActive: {
        background: 'var(--halo-accent, #7c3aed)',
        borderColor: 'var(--halo-accent, #7c3aed)',
        color: '#fff',
    },
    searchInput: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid var(--halo-border, #444)',
        background: 'var(--halo-bg-secondary, #252525)',
        color: 'var(--halo-text, #fff)',
        fontSize: '13px',
        outline: 'none',
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        overflowY: 'auto',
        flex: 1,
        maxHeight: 'calc(100vh - 120px)', // Approx adjustment
    },
    tabItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'background 0.2s',
        border: '1px solid transparent',
        position: 'relative',
    },
    tabItemActive: {
        background: 'var(--halo-bg-secondary, #252525)',
        borderColor: 'var(--halo-accent, #7c3aed)',
    },
    favicon: {
        width: '16px',
        height: '16px',
        borderRadius: '2px',
    },
    tabInfo: {
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    tabTitle: {
        fontSize: '13px',
        color: 'var(--halo-text, #fff)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    tabUrl: {
        fontSize: '11px',
        color: 'var(--halo-text-muted, #666)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    indicators: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
    },
    indicator: {
        fontSize: '12px',
    },
    closeBtn: {
        opacity: 0.6,
        padding: '4px',
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        transition: 'all 0.2s',
        color: 'var(--halo-text-muted, #888)',
    },
    empty: {
        textAlign: 'center',
        padding: '40px',
        color: 'var(--halo-text-muted, #666)',
        fontSize: '13px',
    },
};

export const TabsPanel: React.FC = () => {
    const { t } = useTranslation();
    const [tabs, setTabs] = useState<TabItem[]>([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<TabFilter>('all');
    const [loading, setLoading] = useState(true);

    const refreshTabs = async () => {
        try {
            const list = await getTabs();
            setTabs(list);
            setLoading(false);
        } catch (err) {
            console.error('Failed to get tabs', err);
        }
    };

    useEffect(() => {
        refreshTabs();
        const cleanup = setupTabListeners(refreshTabs);
        return cleanup;
    }, []);

    const filteredTabs = useMemo(() => {
        return tabs.filter(tab => {
            const matchesSearch = tab.title.toLowerCase().includes(search.toLowerCase()) || 
                                tab.url.toLowerCase().includes(search.toLowerCase());
            
            if (!matchesSearch) return false;

            if (filter === 'audible') return tab.audible;
            if (filter === 'pinned') return tab.pinned;
            return true;
        });
    }, [tabs, search, filter]);

    const handleClose = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        await closeTab(id);
        // Optimistic update
        setTabs(prev => prev.filter(t => t.id !== id));
    };

    const handleActivate = async (id: number) => {
        await activateTab(id);
    };

    return (
        <div style={styles.container}>
            <input
                style={styles.searchInput}
                placeholder={t('tabsPanel.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

            <div style={styles.filterBar}>
                <div 
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'all' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('all')}
                >
                    {t('tabsPanel.filterAll')} ({tabs.length})
                </div>
                <div 
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'audible' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('audible')}
                >
                    {t('tabsPanel.filterAudible')}
                </div>
                <div 
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'pinned' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('pinned')}
                >
                    {t('tabsPanel.filterPinned')}
                </div>
            </div>

            <div style={styles.list}>
                {filteredTabs.length === 0 && !loading && (
                    <div style={styles.empty}>{t('tabsPanel.noTabs')}</div>
                )}
                {filteredTabs.map(tab => (
                    <div 
                        key={tab.id}
                        style={{
                            ...styles.tabItem,
                            ...(tab.active ? styles.tabItemActive : {})
                        }}
                        onClick={() => handleActivate(tab.id)}
                    >
                        {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} style={styles.favicon} alt="" />
                        ) : (
                            <div style={{...styles.favicon, background: '#ccc'}} />
                        )}
                        
                        <div style={styles.tabInfo}>
                            <div style={styles.tabTitle} title={tab.title}>{tab.title}</div>
                            <div style={styles.tabUrl} title={tab.url}>{new URL(tab.url || 'http://localhost').hostname}</div>
                        </div>

                        <div style={styles.indicators}>
                             {tab.audible && <span style={styles.indicator} title="Audible">🔊</span>}
                             {tab.mutedInfo?.muted && <span style={styles.indicator} title="Muted">🔇</span>}
                             {tab.pinned && <span style={styles.indicator} title="Pinned">📌</span>}
                        </div>

                        <div 
                            style={styles.closeBtn}
                            onClick={(e) => handleClose(e, tab.id)}
                            title={t('tabsPanel.close')}
                        >
                            ✕
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
