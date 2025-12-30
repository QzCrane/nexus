// goal: Tab Manager UI
// eff: Styles and Item component extracted

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { TabItem as TabItemType, TabFilter } from './types';
import { getTabs, activateTab, closeTab, setupTabListeners } from './core';
import { styles } from './panel.styles';
import { TabItem } from './TabItem';

export const TabsPanel: React.FC = () => {
    const { t } = useTranslation();
    const [tabs, setTabs] = useState<TabItemType[]>([]);
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
                    <TabItem
                        key={tab.id}
                        tab={tab}
                        onActivate={handleActivate}
                        onClose={handleClose}
                        closeLabel={t('tabsPanel.close')}
                    />
                ))}
            </div>
        </div>
    );
};
