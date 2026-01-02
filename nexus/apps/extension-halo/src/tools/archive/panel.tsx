// goal: Archive panel UI - save and manage page snapshots

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ArchiveEntry } from './types';
import { captureCurrentPage, downloadArchive, openInViewer, saveEntryMeta, getStoredEntries, deleteEntry } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};

const formatDate = (ts: number): string => new Date(ts).toLocaleString();

export const ArchivePanel: React.FC = () => {
	const { t } = useTranslation();
	const [entries, setEntries] = useToolState<ArchiveEntry[]>('archive' as any, []);
	const [isCapturing, setIsCapturing] = useState(false);
	const [lastCaptured, setLastCaptured] = useToolState<ArchiveEntry | null>('archive-last' as any, null);


	const handleCapture = useCallback(async () => {
		setIsCapturing(true);
		const entry = await captureCurrentPage();
		if (entry) {
			setLastCaptured(entry);
			await saveEntryMeta(entry);
			setEntries(await getStoredEntries());
		}
		setIsCapturing(false);
	}, []);

	const handleDownload = useCallback(async () => {
		if (lastCaptured) await downloadArchive(lastCaptured);
	}, [lastCaptured]);

	const handleOpen = useCallback(async (entry: ArchiveEntry) => {
		await openInViewer(entry);
	}, []);

	const handleDelete = useCallback(async (id: string) => {
		await deleteEntry(id);
		setEntries(await getStoredEntries());
		if (lastCaptured?.id === id) setLastCaptured(null);
	}, [lastCaptured]);

	return (
		<div style={styles.wrapper}>
			<button style={styles.btn} onClick={handleCapture} disabled={isCapturing}>
				{isCapturing ? '⏳' : '📥'} {isCapturing ? t('archive.capturing') : t('archive.capture')}
			</button>

			{lastCaptured && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<span style={{ fontSize: '24px' }}>✅</span>
						<div style={{ flex: 1 }}>
							<div style={styles.entryTitle}>{lastCaptured.title}</div>
							<div style={styles.entryMeta}>{formatSize(lastCaptured.size)}</div>
						</div>
						<button style={styles.btnSecondary} onClick={() => handleOpen(lastCaptured)}>👁️ {t('archive.view')}</button>
						<button style={styles.btn} onClick={handleDownload}>💾 {t('archive.download')}</button>
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
							<button style={styles.btnSecondary} onClick={() => handleOpen(entry)}>👁️ {t('archive.view')}</button>
							<button style={styles.btnSecondary} onClick={async () => await downloadArchive(entry)}>💾</button>
							<button style={styles.btnDanger} onClick={() => handleDelete(entry.id)}>🗑️</button>
						</div>
					</div>
				))
			)}
		</div>
	);
};
