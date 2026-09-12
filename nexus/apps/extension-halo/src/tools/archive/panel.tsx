// goal: Archive panel UI - save and manage page snapshots

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ArchiveEntry } from './types';
import { archiveLastCodec, captureCurrentPage, downloadArchive, getStoredEntries, deleteEntry, reconcileArchiveOrphans } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};

const formatDate = (ts: number): string => new Date(ts).toLocaleString();

export const ArchivePanel: React.FC = () => {
	const { t } = useTranslation();
	// The persisted metadata list lives only in core-owned storage; this state
	// is a mount-scoped view refreshed from every mutation's returned list.
	const [entries, setEntries] = useState<ArchiveEntry[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [lastCaptured, setLastCaptured, , lastRecovery] = useToolState<ArchiveEntry | null>('archive-last', null, { codec: archiveLastCodec });
	const task = useOwnedAsyncTask();

	useEffect(() => {
		void task.run(async () => {
			await reconcileArchiveOrphans();
			return getStoredEntries();
		}).then((outcome) => {
			if (outcome.kind === 'succeeded') setEntries(outcome.value);
			else if (outcome.kind === 'failed') setLoadError(String(outcome.error));
		});
	}, [task.run]);

	const handleCapture = useCallback(async () => {
		setLoadError(null);
		const outcome = await task.run(async () => {
			const entry = await captureCurrentPage();
			return { entry, entries: await getStoredEntries() };
		});
		if (outcome.kind === 'succeeded') {
			setLastCaptured(outcome.value.entry);
			setEntries(outcome.value.entries);
		} else if (outcome.kind === 'failed') setLoadError(String(outcome.error));
	}, [setLastCaptured, task.run]);

	const handleDownload = useCallback(async () => {
		if (!lastCaptured) return;
		const outcome = await task.run(() => downloadArchive(lastCaptured));
		if (outcome.kind === 'failed') setLoadError(String(outcome.error));
	}, [lastCaptured, task.run]);

	const handleDelete = useCallback(async (id: string) => {
		setLoadError(null);
		const outcome = await task.run(async () => {
			await deleteEntry(id);
			return getStoredEntries();
		});
		if (outcome.kind === 'succeeded') {
			setEntries(outcome.value);
			if (lastCaptured?.id === id) setLastCaptured(null);
		} else if (outcome.kind === 'failed') setLoadError(String(outcome.error));
	}, [lastCaptured, setLastCaptured, task.run]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={lastRecovery} emptyValue={null} exportName="halo-archive-last-damaged.json" />
			<div style={{ color: 'var(--halo-text-secondary)', fontSize: '12px' }}>{t('archive.openHint')}</div>
			<button type="button" style={styles.btn} onClick={task.phase === 'running' ? task.cancel : handleCapture}>
				{task.phase === 'running' ? '✕ Cancel' : `📥 ${t('archive.capture')}`}
			</button>

			{(loadError !== null || task.error !== null) && <div style={{ color: '#d33', fontSize: '12px', padding: '4px 0' }}>{loadError ?? String(task.error)}</div>}

			{lastCaptured && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<span style={{ fontSize: '24px' }}>✅</span>
						<div style={{ flex: 1 }}>
							<div style={styles.entryTitle}>{lastCaptured.title}</div>
							<div style={styles.entryMeta}>{formatSize(lastCaptured.size)}</div>
						</div>
						<button type="button" style={styles.btn} onClick={handleDownload}>💾 {t('archive.download')}</button>
					</div>
				</Card>
			)}

			<div>
				<span style={styles.label}>{t('archive.history')} ({entries.length})</span>
			</div>

			{entries.length === 0 ? (
				<div style={styles.emptyState}>
					<div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
					{t('archive.empty')}
				</div>
			) : (
				entries.slice(0, 10).map((entry) => (
					<div key={entry.id} style={styles.entryCard}>
						<div style={styles.entryTitle}>{entry.title}</div>
						<div style={styles.entryMeta}>{formatDate(entry.savedAt)} • {formatSize(entry.size)}</div>
						<div style={styles.entryMeta} title={entry.url}>{entry.url.slice(0, 60)}{entry.url.length > 60 ? '...' : ''}</div>
						<div style={styles.entryActions}>
							<button type="button" style={styles.btnSecondary} onClick={() => { void task.run(() => downloadArchive(entry)); }}>💾</button>
							<button type="button" style={styles.btnDanger} onClick={() => handleDelete(entry.id)}>🗑️</button>
						</div>
					</div>
				))
			)}
		</div>
	);
};
