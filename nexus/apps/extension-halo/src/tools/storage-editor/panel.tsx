// goal: Storage Editor panel UI - edit localStorage/sessionStorage

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { StorageItem } from './types';
import { scanActiveTabStorage, setStorageItem, deleteStorageItem, formatSize, type StorageSnapshot } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const StorageEditorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [items, setItems] = useState<StorageItem[]>([]);
	const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useToolState<'all' | 'localStorage' | 'sessionStorage'>('storage-editor-filter', 'all');

	const [loading, setLoading] = useState(false);
	const [scanned, setScanned] = useState(false);

	// Scan
	const handleScan = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await scanActiveTabStorage();
			setItems(result.items);
			setSnapshot(result);
			setScanned(true);
		} catch (scanError) {
			setError(String(scanError));
		} finally {
			setLoading(false);
		}
	}, []);

	// Update value
	const handleUpdate = useCallback(async (item: StorageItem, newValue: string) => {
		if (!snapshot) return;
		setError(null);
		try {
			await setStorageItem(item.key, newValue, item.type, snapshot);
			setItems((prev) => prev.map((i) => i.key === item.key && i.type === item.type ? { ...i, value: newValue, size: newValue.length } : i));
		} catch (updateError) {
			// The stored value is unchanged; surface the failure instead of a false success.
			setError(String(updateError));
		}
	}, [snapshot]);

	// Delete
	const handleDelete = useCallback(async (item: StorageItem) => {
		if (!snapshot) return;
		setError(null);
		try {
			await deleteStorageItem(item.key, item.type, snapshot);
			setItems((prev) => prev.filter((i) => !(i.key === item.key && i.type === item.type)));
		} catch (deleteError) {
			setError(String(deleteError));
		}
	}, [snapshot]);

	// Filter
	const filtered = items.filter((i) => filter === 'all' || i.type === filter);

	return (
		<div style={styles.wrapper}>
			{/* Scan Button */}
			<button type="button" style={styles.btn} onClick={handleScan} disabled={loading}>
				{loading ? '⏳' : '🔍'} {t('storageEditor.scan')}
			</button>

			{error && <div style={{ color: '#d33', fontSize: '12px', padding: '4px 0' }}>{error}</div>}

			{/* Filter */}
			{scanned && (
				<div style={styles.filter}>
					{(['all', 'localStorage', 'sessionStorage'] as const).map((f) => (
						<button type="button"
							key={f}
							style={{ ...styles.filterBtn, background: filter === f ? 'var(--halo-accent)' : 'var(--halo-bg-tertiary)', color: filter === f ? '#fff' : 'var(--halo-text)' }}
							onClick={() => setFilter(f)}
						>
							{f === 'all' ? 'All' : f}
						</button>
					))}
				</div>
			)}

			{/* List */}
			{scanned && (
				<div style={styles.list}>
					{filtered.length === 0 ? (
						<div style={styles.empty}>📦 {t('storageEditor.empty')}</div>
					) : (
						filtered.map((item) => (
							<div key={`${item.type}-${item.key}`} style={styles.item}>
								<div style={styles.itemHeader}>
									<span style={styles.key}>{item.key}</span>
									<span style={{ ...styles.type, background: item.type === 'localStorage' ? '#3b82f6' : '#f59e0b' }}>
										{item.type === 'localStorage' ? 'local' : 'session'}
									</span>
								</div>
								<textarea
									style={styles.value}
									defaultValue={item.value}
									onBlur={(e) => e.target.value !== item.value && handleUpdate(item, e.target.value)}
								/>
								<div style={styles.meta}>
									<span>{formatSize(item.size)}</span>
									<button type="button" style={styles.btnSecondary} onClick={() => handleDelete(item)}>🗑️</button>
								</div>
							</div>
						))
					)}
				</div>
			)}

			{!scanned && <div style={styles.empty}>📦 {t('storageEditor.clickToScan')}</div>}
		</div>
	);
};
