// goal: Tab List Item Component
// eff: Extracted to separate file

import type React from 'react';
import type { TabItem as TabItemType } from './types';
import { styles } from './panel.styles';

import { useTranslation } from '../../i18n';

interface TabItemProps {
    tab: TabItemType;
    onActivate: (id: number) => void;
    onClose: (e: React.MouseEvent, id: number) => void;
    closeLabel: string;
}

export const TabItem: React.FC<TabItemProps> = ({ tab, onActivate, onClose, closeLabel }) => {
    const { t } = useTranslation();
    return (
        <div
            style={{
                ...styles.tabItem,
                ...(tab.active ? styles.tabItemActive : {}),
                cursor: 'default',
            }}
        >
            <button
                type="button"
                onClick={() => onActivate(tab.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
                {tab.favIconUrl ? (
                    <img src={tab.favIconUrl} style={styles.favicon} alt="" />
                ) : (
                    <span style={{...styles.favicon, background: '#ccc'}} />
                )}

                <span style={styles.tabInfo}>
                    <span style={{ ...styles.tabTitle, display: 'block' }} title={tab.title}>{tab.title}</span>
                    <span style={{ ...styles.tabUrl, display: 'block' }} title={tab.url}>{new URL(tab.url || 'http://localhost').hostname}</span>
                </span>

                <span style={styles.indicators}>
                    {tab.audible && <span style={styles.indicator} title={t('tabsPanel.tooltips.audible')}>🔊</span>}
                    {tab.mutedInfo?.muted && <span style={styles.indicator} title={t('tabsPanel.tooltips.muted')}>🔇</span>}
                    {tab.pinned && <span style={styles.indicator} title={t('tabsPanel.tooltips.pinned')}>📌</span>}
                </span>
            </button>

            <button
                type="button"
                style={{ ...styles.closeBtn, border: 'none', background: 'transparent' }}
                onClick={(e) => onClose(e, tab.id)}
                title={closeLabel}
            >
                ✕
            </button>
        </div>
    );
};
