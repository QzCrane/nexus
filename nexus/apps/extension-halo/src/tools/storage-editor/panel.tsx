// goal: Storage Editor panel UI - edit localStorage/sessionStorage

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { StorageItem } from './types';
import { getStorageItems, setStorageItem, deleteStorageItem, formatSize } from './core';
import { styles } from './panel.styles';

export const StorageEditorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [items, setItems] = useState<StorageItem[]>([]);
	const [filter, setFilter] = useState<'all' | 'localStorage' | 'sessionStorage'>('all');
	const [loading, setLoading] = useState(false);
	const [scanned, setScanned] = useState(false);

	// Scan
	const handleScan = useCallback(async () => {
		setLoading(true);
		const result = await getStorageItems();
		setItems(result);
		setLoading(false);
		setScanned(true);
	}, []);

	// Update value
	const handleUpdate = useCallback(async (item: StorageItem, newValue: string) => {
		await setStorageItem(item.key, newValue, item.type);
		setItems((prev) => prev.map((i) => i.key === item.key && i.type === item.type ? { ...i, value: newValue, size: newValue.length } : i));
	}, []);

	// Delete
	const handleDelete = useCallback(async (item: StorageItem) => {
		await deleteStorageItem(item.key, item.type);
		setItems((prev) => prev.filter((i) => !(i.key === item.key && i.type === item.type)));
	}, []);

	// Filter
	const filtered = items.filter((i) => filter === 'all' || i.type === filter);

	return (
		<div style={styles.wrapper}>
			{/* Scan Button */}
			<button style={styles.btn} onClick={handleScan} disabled={loading}>
				{loading ? '⏳' : '🔍'} {t('storageEditor.scan')}
			</button>

			{/* Filter */}
			{scanned && (
				<div style={styles.filter}>
					{(['all', 'localStorage', 'sessionStorage'] as const).map((f) => (
						<button
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
									<button style={styles.btnSecondary} onClick={() => handleDelete(item)}>🗑️</button>
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
