// goal: Tab List Item Component
// eff: Extracted to separate file

import React from 'react';
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
                ...(tab.active ? styles.tabItemActive : {})
            }}
            onClick={() => onActivate(tab.id)}
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
                 {tab.audible && <span style={styles.indicator} title={t('tabsPanel.tooltips.audible')}>🔊</span>}
                 {tab.mutedInfo?.muted && <span style={styles.indicator} title={t('tabsPanel.tooltips.muted')}>🔇</span>}
                 {tab.pinned && <span style={styles.indicator} title={t('tabsPanel.tooltips.pinned')}>📌</span>}
            </div>

            <div 
                style={styles.closeBtn}
                onClick={(e) => onClose(e, tab.id)}
                title={closeLabel}
            >
                ✕
            </div>
        </div>
    );
};
