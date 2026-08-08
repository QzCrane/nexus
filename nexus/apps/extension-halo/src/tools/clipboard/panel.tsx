// goal: Clipboard tool panel UI with i18n support
// eff: Components extracted to reduce file size

import React, { useEffect, useMemo, useState } from 'react';
import { useToolState } from '../../kernel';
import { subscribeHaloStorageChanges } from '../../kernel/core/storage-change-bus';
import { useTranslation } from '../../i18n';
import {
	clearUnpinned,
	copyToClipboard,
	deleteItem,
	getClipboardHistory,
	getClipboardSettings,
	togglePin,
	updateClipboardSettings,
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
	const [newIds, setNewIds] = useState<Set<string>>(new Set());
	const prevHistoryRef = React.useRef<ClipboardItemType[]>([]);
	const firstLoadRef = React.useRef(true);
	const highlightTimersRef = React.useRef<Set<number>>(new Set());

	useEffect(() => {
		let disposed = false;
		let historyAuthorityChanged = false;
		let settingsAuthorityChanged = false;

		const unsubscribeStorageChanges = subscribeHaloStorageChanges((changes, area) => {
			if (disposed || area !== 'local') return;
			const historyChange = changes.halo_tool_clipboard_history;
			if (historyChange) {
				historyAuthorityChanged = true;
				setHistory(historyChange.newValue || []);
			}
			const settingsChange = changes.halo_tool_clipboard_settings;
			if (settingsChange) {
				settingsAuthorityChanged = true;
				setEnabled(settingsChange.newValue?.enabled ?? true);
			}
		});

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
			unsubscribeStorageChanges();
			for (const timerId of highlightTimersRef.current) window.clearTimeout(timerId);
			highlightTimersRef.current.clear();
		};
	}, []);

	useEffect(() => {
		if (firstLoadRef.current) {
			firstLoadRef.current = false;
			prevHistoryRef.current = history;
			return;
		}

		if (history.length > 0) {
			const prevIds = new Set(prevHistoryRef.current.map((item) => item.id));
			const addedIds = history
				.filter((item) => !prevIds.has(item.id))
				.map((item) => item.id);
			if (addedIds.length > 0) {
				setNewIds((previous) => {
					const next = new Set(previous);
					for (const id of addedIds) next.add(id);
					return next;
				});
				const timerId = window.setTimeout(() => {
					highlightTimersRef.current.delete(timerId);
					setNewIds((previous) => {
						const next = new Set(previous);
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
		if (await copyToClipboard(text)) showToast(t('clipboardPanel.copied'));
	};

	const handlePin = async (id: string) => setHistory(await togglePin(id));
	const handleDelete = async (id: string) => setHistory(await deleteItem(id));
	const handleClear = async () => {
		if (confirm(t('clipboardPanel.confirmClear'))) setHistory(await clearUnpinned());
	};

	const filteredHistory = useMemo(() => {
		if (!search) return history;
		const normalizedSearch = search.toLowerCase();
		return history.filter((item) =>
			item.text.toLowerCase().includes(normalizedSearch)
			|| item.sourceTitle?.toLowerCase().includes(normalizedSearch));
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
				) : filteredHistory.map((item) => (
					<ClipboardItem
						key={item.id}
						item={item}
						isNew={newIds.has(item.id)}
						onCopy={handleCopy}
						onPin={handlePin}
						onDelete={handleDelete}
					/>
				))}
			</div>
		</div>
	);
};
