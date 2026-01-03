// goal: Tab Group panel UI

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { checkPermission, requestPermission, getGroups, createGroup, ungroup, updateGroup, type TabGroupInfo } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export const TabGroupPanel: React.FC = () => {
    const { t } = useTranslation();
    const [hasPerm, setHasPerm] = useState(false);
    const [groups, setGroups] = useState<TabGroupInfo[]>([]);
    const [showCreate, setShowCreate] = useToolState<boolean>('tab-group-show-create' as any, false);
    const [newTitle, setNewTitle] = useToolState<string>('tab-group-title' as any, '');
    const [newColor, setNewColor] = useToolState<any>('tab-group-color' as any, 'blue');



    const load = useCallback(async () => {
        const p = await checkPermission();
        setHasPerm(p);
        if (p) {
            const g = await getGroups();
            setGroups(g);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Event-driven updates using Chrome API listeners (no polling!)
    useEffect(() => {
        if (!hasPerm) return;
		
        // Chrome tabGroups event listeners
        const onCreated = () => load();
        const onRemoved = () => load();
        const onUpdated = () => load();
        const onTabUpdated = () => load();
		
        chrome.tabGroups?.onCreated?.addListener(onCreated);
        chrome.tabGroups?.onRemoved?.addListener(onRemoved);
        chrome.tabGroups?.onUpdated?.addListener(onUpdated);
        chrome.tabs?.onUpdated?.addListener(onTabUpdated);
		
        return () => {
            chrome.tabGroups?.onCreated?.removeListener(onCreated);
            chrome.tabGroups?.onRemoved?.removeListener(onRemoved);
            chrome.tabGroups?.onUpdated?.removeListener(onUpdated);
            chrome.tabs?.onUpdated?.removeListener(onTabUpdated);
        };
    }, [hasPerm, load]);

    const handleRequestPerm = async () => {
        const granted = await requestPermission();
        if (granted) load();
    };

    const handleCreate = async () => {
        await createGroup(newTitle, newColor);
        setShowCreate(false);
        setNewTitle('');
        load();
    };

    if (!hasPerm) {
        return (
            <div style={styles.wrapper}>
                <div style={styles.permission}>
                    <div style={{fontSize: '40px'}}>📑</div>
                    <div>{t('tabGroup.permTitle', { defaultValue: 'Tab Groups requires permission' })}</div>
                    <button style={styles.permBtn} onClick={handleRequestPerm}>{t('tabGroup.permBtn', { defaultValue: 'Enable Tab Groups' })}</button>
                </div>

            </div>
        );
    }

    return (
        <div style={styles.wrapper}>
            <div style={styles.header}>
                <div style={{fontWeight: 600}}>{t('tabGroup.title', { defaultValue: 'Tab Groups' })} ({groups.length})</div>
                <button style={styles.createBtn} onClick={() => setShowCreate(!showCreate)}>{t('tabGroup.newGroup', { defaultValue: '+ New Group' })}</button>
            </div>

            {showCreate && (
                <div style={styles.createForm}>
                    <input 
                        style={styles.input} 
                        value={newTitle} 
                        onChange={e => setNewTitle(e.target.value)} 
                        placeholder={t('tabGroup.createPlaceholder', { defaultValue: 'Group Title...' })} 
                    />

                    <div style={styles.colors}>
                        {COLORS.map(c => (
                            <div 
                                key={c} 
                                style={{
                                    ...styles.colorOption, 
                                    background: c, 
                                    borderColor: newColor === c ? 'var(--halo-text)' : 'transparent'
                                }}
                                onClick={() => setNewColor(c)}
                            />
                        ))}
                    </div>
                    <button style={styles.createBtn} onClick={handleCreate}>{t('tabGroup.create', { defaultValue: 'Create from Selected Tabs' })}</button>
                </div>

            )}

            <div style={styles.list}>
                {groups.map(g => (
                    <div key={g.id} style={styles.card}>
                        <div style={styles.groupHeader}>
                            <div style={styles.groupTitle}>
                                <div style={{...styles.dot, background: g.color}} />
                                {g.title || t('tabGroup.untitled', { defaultValue: 'Untitled' })}
                            </div>
                            <div style={styles.controls}>
                                <button style={styles.iconBtn} onClick={() => updateGroup(g.id, { collapsed: !g.collapsed })}>
                                    {g.collapsed ? t('tabGroup.expand', { defaultValue: 'Expand' }) : t('tabGroup.collapse', { defaultValue: 'Collapse' })}
                                </button>
                                <button style={{...styles.iconBtn, color: '#ef4444'}} onClick={() => ungroup(g.id)}>
                                    {t('tabGroup.ungroup', { defaultValue: 'Ungroup' })}
                                </button>
                            </div>
                        </div>

                        {!g.collapsed && (
                            <div style={styles.tabs}>
                                {g.tabs.map(t => (
                                    <div key={t.id}>{t.title}</div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
