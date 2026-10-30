// goal: Tab Group panel UI

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { checkPermission, requestPermission, getGroups, createGroup, ungroup, updateGroup, type TabGroupInfo } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const satisfies readonly chrome.tabGroups.Color[];
type TabGroupColor = typeof COLORS[number];
const tabGroupColorCodec: ToolStateCodec<TabGroupColor> = {
	decode: (value) => typeof value === 'string' && (COLORS as readonly string[]).includes(value)
		? { kind: 'valid', value: value as TabGroupColor } : { kind: 'invalid', reason: 'Tab group color is invalid.' },
	encode: (value) => value,
};

export const TabGroupPanel: React.FC = () => {
    const { t } = useTranslation();
    const [hasPerm, setHasPerm] = useState(false);
    const [groups, setGroups] = useState<TabGroupInfo[]>([]);
    const [showCreate, setShowCreate] = useToolState<boolean>('tab-group-show-create', false);
    const [newTitle, setNewTitle] = useToolState<string>('tab-group-title', '');
	const [newColor, setNewColor, , colorRecovery] = useToolState<TabGroupColor>('tab-group-color', 'blue', { codec: tabGroupColorCodec });
	const task = useOwnedAsyncTask();



    const load = useCallback(async () => {
		const outcome = await task.run(async () => {
			const permitted = await checkPermission();
			return { permitted, groups: permitted ? await getGroups() : [] };
		});
		if (outcome.kind === 'succeeded') { setHasPerm(outcome.value.permitted); setGroups(outcome.value.groups); }
	}, [task.run]);

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
		const outcome = await task.run(async () => {
			const granted = await requestPermission();
			return { granted, groups: granted ? await getGroups() : [] };
		});
		if (outcome.kind === 'succeeded') { setHasPerm(outcome.value.granted); setGroups(outcome.value.groups); }
    };

    const handleCreate = async () => {
		const outcome = await task.run(async () => { await createGroup(newTitle, newColor); return getGroups(); });
		if (outcome.kind === 'succeeded') { setGroups(outcome.value); setShowCreate(false); setNewTitle(''); }
    };

    if (!hasPerm) {
        return (
            <div style={styles.wrapper}>
				<StorageRecoveryActions recovery={colorRecovery} emptyValue="blue" exportName="halo-tab-group-color-damaged.json" />
                <div style={styles.permission}>
                    <div style={{fontSize: '40px'}}>📑</div>
                    <div>{t('tabGroup.permTitle', { defaultValue: 'Tab Groups requires permission' })}</div>
                    <button type="button" style={styles.permBtn} onClick={handleRequestPerm}>{t('tabGroup.permBtn', { defaultValue: 'Enable Tab Groups' })}</button>
                </div>

            </div>
        );
    }

    return (
        <div style={styles.wrapper}>
			<StorageRecoveryActions recovery={colorRecovery} emptyValue="blue" exportName="halo-tab-group-color-damaged.json" />
            <div style={styles.header}>
                <div style={{fontWeight: 600}}>{t('tabGroup.title', { defaultValue: 'Tab Groups' })} ({groups.length})</div>
                <button type="button" style={styles.createBtn} onClick={() => setShowCreate(!showCreate)}>{t('tabGroup.newGroup', { defaultValue: '+ New Group' })}</button>
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
                            <button
                                type="button"
                                key={c} 
                                aria-label={c}
                                aria-pressed={newColor === c}
                                style={{
                                    ...styles.colorOption, 
                                    background: c, 
                                    borderColor: newColor === c ? 'var(--halo-text)' : 'transparent',
                                    padding: 0,
                                }}
                                onClick={() => setNewColor(c)}
                            />
                        ))}
                    </div>
                    <button type="button" style={styles.createBtn} onClick={handleCreate}>{t('tabGroup.create', { defaultValue: 'Create from Selected Tabs' })}</button>
                </div>

            )}

            <div style={styles.list}>
				{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}
                {groups.map(g => (
                    <div key={g.id} style={styles.card}>
                        <div style={styles.groupHeader}>
                            <div style={styles.groupTitle}>
                                <div style={{...styles.dot, background: g.color}} />
                                {g.title || t('tabGroup.untitled', { defaultValue: 'Untitled' })}
                            </div>
                            <div style={styles.controls}>
				<button type="button" style={styles.iconBtn} onClick={() => { void task.run(async () => { await updateGroup(g.id, { collapsed: !g.collapsed }); return getGroups(); }).then((outcome) => { if (outcome.kind === 'succeeded') setGroups(outcome.value); }); }}>
                                    {g.collapsed ? t('tabGroup.expand', { defaultValue: 'Expand' }) : t('tabGroup.collapse', { defaultValue: 'Collapse' })}
                                </button>
				<button type="button" style={{...styles.iconBtn, color: '#ef4444'}} onClick={() => { void task.run(async () => { await ungroup(g.id); return getGroups(); }).then((outcome) => { if (outcome.kind === 'succeeded') setGroups(outcome.value); }); }}>
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
