// goal: Clipboard tool panel UI with i18n support
// eff: Components extracted to reduce file size

import React, { useState, useEffect, useMemo } from 'react';
import { useToolState } from '../../kernel';

import { useTranslation } from '../../i18n';
import { 
	getClipboardHistory, 
	togglePin, 
	deleteItem, 
	clearUnpinned, 
	copyToClipboard,
	getClipboardSettings,
	updateClipboardSettings
} from './core';
import type { ClipboardItem as ClipboardItemType } from './types';
import { styles } from './panel.styles';
import { ClipboardItem } from './ClipboardItem';

import { ClipboardHeader } from './ClipboardHeader';

import { useToast } from '../../components/ToastProvider';

export const ClipboardPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [history, setHistory] = useState<ClipboardItemType[]>([]);
	const [search, setSearch] = useToolState<string>('clipboard-search', '');
	const [enabled, setEnabled] = useState(true);

	// Track new items for highlighting
	const [newIds, setNewIds] = useState<Set<string>>(new Set());
	const prevHistoryRef = React.useRef<ClipboardItemType[]>([]);

	// Initial load should not highlight anything
	const firstLoadRef = React.useRef(true);
	const highlightTimersRef = React.useRef<Set<number>>(new Set());

	useEffect(() => {
		let disposed = false;
		let historyAuthorityChanged = false;
		let settingsAuthorityChanged = false;

		const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
			if (area !== 'local') return;
			if (changes.halo_tool_clipboard_history) {
				historyAuthorityChanged = true;
				setHistory(changes.halo_tool_clipboard_history.newValue || []);
			}
			if (changes.halo_tool_clipboard_settings) {
				settingsAuthorityChanged = true;
				setEnabled(changes.halo_tool_clipboard_settings.newValue?.enabled ?? true);
			}
		};
		chrome.storage.onChanged.addListener(listener);

		void getClipboardHistory()
			.then((loadedHistory) => {
				if (!disposed && !historyAuthorityChanged) setHistory(loadedHistory);
			})
			.catch((error: unknown) => {
				console.error('[HALO:Clipboard] Failed to load clipboard history', error);
			});
		void getClipboardSettings()
			.then((loadedSettings) => {
				if (!disposed && !settingsAuthorityChanged) setEnabled(loadedSettings.enabled);
			})
			.catch((error: unknown) => {
				console.error('[HALO:Clipboard] Failed to load clipboard settings', error);
			});

		return () => {
			disposed = true;
			chrome.storage.onChanged.removeListener(listener);
			for (const timerId of highlightTimersRef.current) {
				window.clearTimeout(timerId);
			}
			highlightTimersRef.current.clear();
		};
	}, []);

	// Unify history change handling for highlighting
	useEffect(() => {
		if (firstLoadRef.current) {
			firstLoadRef.current = false;
			prevHistoryRef.current = history;
			return;
		}

		if (history.length > 0) {
			const prevIds = new Set(prevHistoryRef.current.map(h => h.id));
			const addedIds = history
				.filter(h => !prevIds.has(h.id))
				.map(h => h.id);

			if (addedIds.length > 0) {
				setNewIds(prev => {
					const next = new Set(prev);
					for (const id of addedIds) next.add(id);
					return next;
				});

				const timerId = window.setTimeout(() => {
					highlightTimersRef.current.delete(timerId);
					setNewIds(prev => {
						const next = new Set(prev);
						for (const id of addedIds) next.delete(id);
						return next;
					});
				}, 2000);
				highlightTimersRef.current.add(timerId);
			}
		}

		prevHistoryRef.current = history;
	}, [history]);

	const handleToggle = async (checked: boolean) => {
		await updateClipboardSettings(checked);
		setEnabled(checked);
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
			<ClipboardHeader 
				enabled={enabled}
				onToggle={handleToggle}
				search={search}
				onSearchChange={setSearch}
				onClear={handleClear}
			/>

			<div style={styles.list}>
				{filteredHistory.length === 0 ? (
					<div style={styles.empty}>{t('clipboardPanel.empty')}</div>
				) : (
					filteredHistory.map(item => (
						<ClipboardItem
							key={item.id}
							item={item}
							isNew={newIds.has(item.id)}
							onCopy={handleCopy}
							onPin={handlePin}
							onDelete={handleDelete}
						/>
					))
				)}
			</div>
		</div>
	);
};
