// goal: Tab Manager UI
// eff: Styles and Item component extracted

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { TabItem as TabItemType, TabFilter } from './types';
import { getTabs, activateTab, closeTab, setupTabListeners } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';

import { TabItem } from './TabItem';

export const TabsPanel: React.FC = () => {
    const { t } = useTranslation();
    const [tabs, setTabs] = useState<TabItemType[]>([]);
    const [search, setSearch] = useToolState<string>('tabs-search', '');
    const [filter, setFilter] = useToolState<TabFilter>('tabs-filter', 'all');

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let disposed = false;
        let requestRevision = 0;
        const refreshTabs = (): void => {
            const revision = ++requestRevision;
            void getTabs()
                .then((list) => {
                    if (!disposed && revision === requestRevision) setTabs(list);
                })
                .catch((error: unknown) => {
                    console.error('[HALO:Tabs] Failed to get tabs', error);
                })
                .finally(() => {
                    if (!disposed && revision === requestRevision) setLoading(false);
                });
        };

        refreshTabs();
        const cleanup = setupTabListeners(refreshTabs);
        return () => {
            disposed = true;
            requestRevision++;
            cleanup();
        };
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
        try {
            await closeTab(id);
            // Optimistic update
            setTabs(prev => prev.filter(t => t.id !== id));
        } catch (error: unknown) {
            console.error(`[HALO:Tabs] Failed to close tab ${id}`, error);
        }
    };

    const handleActivate = async (id: number) => {
        try {
            await activateTab(id);
        } catch (error: unknown) {
            console.error(`[HALO:Tabs] Failed to activate tab ${id}`, error);
        }
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
                <button
					type="button"
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'all' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('all')}
                >
                    {t('tabsPanel.filterAll')} ({tabs.length})
                </button>
                <button
					type="button"
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'audible' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('audible')}
                >
                    {t('tabsPanel.filterAudible')}
                </button>
                <button
					type="button"
                    style={{
                        ...styles.filterChip,
                        ...(filter === 'pinned' ? styles.filterChipActive : {})
                    }}
                    onClick={() => setFilter('pinned')}
                >
                    {t('tabsPanel.filterPinned')}
                </button>
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
