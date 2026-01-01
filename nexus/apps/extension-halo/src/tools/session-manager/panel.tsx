// goal: Session Manager panel UI

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { saveSession, getSessions, deleteSession, restoreSession, type Session } from './core';
import { styles } from './panel.styles';

export const SessionManagerPanel: React.FC = () => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);

    const loadSessions = useCallback(async () => {
        const list = await getSessions();
        setSessions(list);
    }, []);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    const handleSave = async () => {
        setLoading(true);
        await saveSession(name);
        setName('');
        await loadSessions();
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (confirm('Delete this session?')) {
            await deleteSession(id);
            await loadSessions();
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
                    placeholder={t('sessionManager.placeholder', 'Session Name (Optional)...')} 
                />
                <button style={styles.btn} onClick={handleSave} disabled={loading}>
                    💾 {t('sessionManager.save', 'Save')}
                </button>
            </div>

            <div style={styles.list}>
                {sessions.length === 0 ? (
                    <div style={{textAlign: 'center', padding: '20px', color: 'var(--halo-text-muted)', fontSize: '13px'}}>
                        {t('sessionManager.noSessions', 'No saved sessions')}
                    </div>
                ) : (
                    sessions.map(s => (
                        <div key={s.id} style={styles.card}>
                            <div style={styles.header}>
                                <div style={styles.title}>{s.name}</div>
                                <div style={styles.meta}>{new Date(s.createdAt).toLocaleDateString()} • {s.tabs.length} {t('sessionManager.tabs', 'Tabs')}</div>
                            </div>
                            
                            <div style={styles.tabList}>
                                {s.tabs.slice(0, 5).map((t, i) => (
                                    <div key={i} style={styles.tabItem} title={t.title}>
                                        {t.pinned ? '📌 ' : ''}{t.title || t.url}
                                    </div>
                                ))}
                                {s.tabs.length > 5 && <div style={styles.tabItem}>{t('sessionManager.more', '...and {{count}} more', {count: s.tabs.length - 5})}</div>}
                            </div>

                            <div style={styles.actions}>
                                <button style={styles.primaryBtn} onClick={() => handleRestore(s, false)}>{t('sessionManager.openHere', 'Open Here')}</button>
                                <button style={styles.actionBtn} onClick={() => handleRestore(s, true)}>{t('sessionManager.newWindow', 'New Window')}</button>
                                <button style={styles.deleteBtn} onClick={() => handleDelete(s.id)} title={t('sessionManager.deleteConfirm', 'Delete?')}>🗑️</button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
