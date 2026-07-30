// goal: Session Manager panel UI

import type React from 'react';
import { useState, } from 'react';
import { useTranslation } from '../../i18n';
import { saveSession, getSessions, deleteSession, restoreSession, type Session } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const SessionManagerPanel: React.FC = () => {
    const { t } = useTranslation();
    const [name, setName] = useToolState<string>('session-name', '');
    const [sessions, setSessions] = useToolState<Session[]>('session-manager', []);

    const [loading, setLoading] = useState(false);



    const handleSave = async () => {
        setLoading(true);
        await saveSession(name);
        setName('');
        setSessions(await getSessions());
        setLoading(false);
    };


    const handleDelete = async (id: string) => {
        if (confirm('Delete this session?')) {
            await deleteSession(id);
            setSessions(await getSessions());
        }
    };


    const handleRestore = async (session: Session, newWindow: boolean) => {
        await restoreSession(session, newWindow);
    };

    return (
        <div style={styles.wrapper}>
            <div style={styles.controls}>
                <input 
                    style={styles.input} 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder={t('sessionManager.placeholder', { defaultValue: 'Session Name (Optional)...' })} 
                />
                <button type="button" style={styles.btn} onClick={handleSave} disabled={loading}>
                    💾 {t('sessionManager.save', { defaultValue: 'Save' })}
                </button>
            </div>

            <div style={styles.list}>
                {sessions.length === 0 ? (
                    <div style={{textAlign: 'center', padding: '20px', color: 'var(--halo-text-muted)', fontSize: '13px'}}>
                        {t('sessionManager.noSessions', { defaultValue: 'No saved sessions' })}
                    </div>
                ) : (
                    sessions.map(s => (
                        <div key={s.id} style={styles.card}>
                            <div style={styles.header}>
                                <div style={styles.title}>{s.name}</div>
                                <div style={styles.meta}>{new Date(s.createdAt).toLocaleDateString()} • {s.tabs.length} {t('sessionManager.tabs', { defaultValue: 'Tabs' })}</div>
                            </div>
                            
                            <div style={styles.tabList}>
                                {s.tabs.slice(0, 5).map((tItem, i) => {
                                    // biome-ignore lint/suspicious/noArrayIndexKey: A saved session is an immutable tab-order snapshot, so the tab position is its identity.
                                    return <div key={i} style={styles.tabItem} title={tItem.title}>
                                        {tItem.pinned ? '📌 ' : ''}{tItem.title || tItem.url}
                                    </div>;
                                })}
                                {s.tabs.length > 5 && <div style={styles.tabItem}>{t('sessionManager.more', { defaultValue: '...' })}</div>}
                            </div>

                            <div style={styles.actions}>
                                <button type="button" style={styles.primaryBtn} onClick={() => handleRestore(s, false)}>{t('sessionManager.openHere', { defaultValue: 'Open Here' })}</button>
                                <button type="button" style={styles.actionBtn} onClick={() => handleRestore(s, true)}>{t('sessionManager.newWindow', { defaultValue: 'New Window' })}</button>
                                <button type="button" style={styles.deleteBtn} onClick={() => handleDelete(s.id)} title={t('sessionManager.deleteConfirm', { defaultValue: 'Delete?' })}>🗑️</button>
                            </div>
                        </div>
                    ))
                )}
            </div>

        </div>
    );
};
