// goal: Tab Manager UI
// eff: Styles and Item component extracted

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { TabItem as TabItemType, TabFilter } from './types';
import { getTabs, activateTab, closeTab, setupTabListeners } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

import { TabItem } from './TabItem';

const tabFilterCodec: ToolStateCodec<TabFilter> = {
	decode: (value) => value === 'all' || value === 'audible' || value === 'pinned'
		? { kind: 'valid', value } : { kind: 'invalid', reason: 'Tab filter is invalid.' },
	encode: (value) => value,
};

export const TabsPanel: React.FC = () => {
    const { t } = useTranslation();
    const [tabs, setTabs] = useState<TabItemType[]>([]);
    const [search, setSearch] = useToolState<string>('tabs-search', '');
	const [filter, setFilter, , filterRecovery] = useToolState<TabFilter>('tabs-filter', 'all', { codec: tabFilterCodec });

	const task = useOwnedAsyncTask();

    useEffect(() => {
        const refreshTabs = (): void => {
			void task.run(() => getTabs()).then((outcome) => {
				if (outcome.kind === 'succeeded') setTabs(outcome.value);
			});
        };

        refreshTabs();
        const cleanup = setupTabListeners(refreshTabs);
        return () => {
			task.cancel();
            cleanup();
        };
	}, [task.run, task.cancel]);

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
		const outcome = await task.run(() => closeTab(id));
		if (outcome.kind === 'succeeded') {
            // Optimistic update
            setTabs(prev => prev.filter(t => t.id !== id));
        }
    };

    const handleActivate = async (id: number) => {
		await task.run(() => activateTab(id));
    };

    return (
        <div style={styles.container}>
			<StorageRecoveryActions recovery={filterRecovery} emptyValue="all" exportName="halo-tabs-filter-damaged.json" />
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
				{filteredTabs.length === 0 && task.phase !== 'running' && (
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
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}
        </div>
    );
};
