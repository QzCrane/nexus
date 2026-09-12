// goal: Session Manager panel UI

import type React from 'react';
import { useEffect, useState, } from 'react';
import { useTranslation } from '../../i18n';
import { saveSession, getSessions, deleteSession, restoreSession, type RestoreReport, type Session } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';


export const SessionManagerPanel: React.FC = () => {
    const { t } = useTranslation();
    const [name, setName] = useToolState<string>('session-name', '');
    // The persisted list lives only in core-owned storage; this state is a
    // mount-scoped view refreshed from every mutation's returned list.
    const [sessions, setSessions] = useState<Session[]>([]);
    const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
    const [error, setError] = useState<string | null>(null);
	const task = useOwnedAsyncTask();

    useEffect(() => {
		void task.run(() => getSessions()).then((outcome) => {
			if (outcome.kind === 'succeeded') setSessions(outcome.value);
			else if (outcome.kind === 'failed') setError(String(outcome.error));
		});
		return task.cancel;
	}, [task.run, task.cancel]);

    const handleSave = async () => {
        setError(null);
		const outcome = await task.run(() => saveSession(name));
		if (outcome.kind === 'succeeded') {
			setSessions(outcome.value.sessions);
            setName('');
		} else if (outcome.kind === 'failed') setError(String(outcome.error));
    };


    const handleDelete = async (id: string) => {
        if (confirm('Delete this session?')) {
            setError(null);
			const outcome = await task.run(() => deleteSession(id));
			if (outcome.kind === 'succeeded') setSessions(outcome.value);
			else if (outcome.kind === 'failed') setError(String(outcome.error));
        }
    };


    const handleRestore = async (session: Session, newWindow: boolean) => {
        setError(null);
		const outcome = await task.run(() => restoreSession(session, newWindow));
		if (outcome.kind === 'succeeded') setRestoreReport(outcome.value);
		else if (outcome.kind === 'failed') setError(String(outcome.error));
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
				<button type="button" style={styles.btn} onClick={handleSave} disabled={task.phase === 'running'}>
                    💾 {t('sessionManager.save', { defaultValue: 'Save' })}
                </button>
            </div>

            {error && <div style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px', padding: '4px 0' }}>{error}</div>}
            {restoreReport && (
                <div style={{ fontSize: '12px', padding: '4px 0', color: 'var(--halo-text-muted)' }}>
                    {t('sessionManager.restoreResult', {
                        defaultValue: 'Restored {{restored}} tabs ({{pinned}} pinned); {{failed}} failed.',
                        restored: restoreReport.restored,
                        pinned: restoreReport.pinned,
                        failed: restoreReport.failed.length,
                    })}
                </div>
            )}

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
