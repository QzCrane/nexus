// goal: Clipboard tool panel UI with i18n support
// eff: Components extracted to reduce file size

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { 
	getClipboardHistory, 
	togglePin, 
	deleteItem, 
	clearUnpinned, 
	copyToClipboard 
} from './core';
import type { ClipboardItem as ClipboardItemType } from './types';
import { styles } from './panel.styles';
import { ClipboardItem } from './ClipboardItem';

export const ClipboardPanel: React.FC = () => {
	const { t } = useTranslation();
	const [history, setHistory] = useState<ClipboardItemType[]>([]);
	const [search, setSearch] = useState('');
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadHistory();
		
		// Listen for background updates
		const listener = (changes: any, area: string) => {
			if (area === 'local' && changes['halo_tool_clipboard_history']) {
				setHistory(changes['halo_tool_clipboard_history'].newValue || []);
			}
		};
		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	const loadHistory = async () => {
		const h = await getClipboardHistory();
		setHistory(h);
	};

	const showToast = (msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 2000);
	};

	const handleCopy = async (text: string) => {
		const ok = await copyToClipboard(text);
		if (ok) showToast(t('clipboardPanel.copied'));
	};

	const handlePin = async (id: string) => {
		const updated = await togglePin(id);
		setHistory(updated);
	};

	const handleDelete = async (id: string) => {
		const updated = await deleteItem(id);
		setHistory(updated);
	};

	const handleClear = async () => {
		if (confirm(t('clipboardPanel.confirmClear'))) {
			const updated = await clearUnpinned();
			setHistory(updated);
		}
	};

	const filteredHistory = useMemo(() => {
		if (!search) return history;
		const s = search.toLowerCase();
		return history.filter(item => 
			item.text.toLowerCase().includes(s) || 
			item.sourceTitle?.toLowerCase().includes(s)
		);
	}, [history, search]);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.searchBar}>
					<input 
						style={styles.input}
						placeholder={t('clipboardPanel.searchPlaceholder')}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<button 
						style={styles.clearBtn}
						onClick={handleClear}
						title={t('clipboardPanel.clearUnpinned')}
					>
						🗑️
					</button>
				</div>
			</Card>

			<div style={styles.list}>
				{filteredHistory.length > 0 ? (
					filteredHistory.map((item) => (
						<ClipboardItem 
							key={item.id}
							item={item}
							onPin={handlePin}
							onDelete={handleDelete}
							onCopy={handleCopy}
						/>
					))
				) : (
					<div style={styles.empty}>
						<span style={styles.emptyIcon}>📋</span>
						<p style={styles.emptyText}>
							{search ? t('clipboardPanel.noMatch') : t('clipboardPanel.empty')}
						</p>
					</div>
				)}
			</div>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
