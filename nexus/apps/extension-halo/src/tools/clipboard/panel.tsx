// goal: Clipboard tool panel UI with i18n support
// eff: Components extracted to reduce file size

import React, { useState, useEffect, useMemo } from 'react';
import { useToolState } from '../../kernel';

import { Card } from '@nexus/ui-kit';
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
import { Toggle } from '@nexus/ui-kit';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';

import { ClipboardHeader } from './ClipboardHeader';

export const ClipboardPanel: React.FC = () => {
	const { t } = useTranslation();
	const { setServiceState } = useActiveServices();
	const [history, setHistory] = useState<ClipboardItemType[]>([]);
	const [search, setSearch] = useToolState<string>('clipboard-search' as any, '');
	const [enabled, setEnabled] = useState(true);

	const [toast, setToast] = useState<string | null>(null);
	
	// Track new items for highlighting
	const [newIds, setNewIds] = useState<Set<string>>(new Set());
	const prevHistoryRef = React.useRef<ClipboardItemType[]>([]);

	// Initial load should not highlight anything
	const firstLoadRef = React.useRef(true);

	useEffect(() => {
		loadHistory();
		getClipboardSettings().then(s => {
			setEnabled(s.enabled);
			setServiceState('clipboard', s.enabled);
		});
		
		const listener = (changes: any, area: string) => {
			if (area === 'local') {
				if (changes['halo_tool_clipboard_history']) {
					setHistory(changes['halo_tool_clipboard_history'].newValue || []);
				}
				if (changes['halo_tool_clipboard_settings']) {
					const newState = changes['halo_tool_clipboard_settings'].newValue?.enabled ?? true;
					setEnabled(newState);
					setServiceState('clipboard', newState);
				}
			}
		};
		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	// Unify history change handling for highlighting
	useEffect(() => {
		if (firstLoadRef.current) {
			firstLoadRef.current = false;
			prevHistoryRef.current = history;
			return;
		}

		if (history.length > 0) {
			const currentIds = new Set(history.map(h => h.id));
			const prevIds = new Set(prevHistoryRef.current.map(h => h.id));
			
			const addedIds = history
				.filter(h => !prevIds.has(h.id))
				.map(h => h.id);

			if (addedIds.length > 0) {
				setNewIds(prev => {
					const next = new Set(prev);
					addedIds.forEach(id => next.add(id));
					return next;
				});

				// Auto-remove highlight after animation
				setTimeout(() => {
					setNewIds(prev => {
						const next = new Set(prev);
						addedIds.forEach(id => next.delete(id));
						return next;
					});
				}, 2000);
			}
		}
		
		prevHistoryRef.current = history;
	}, [history]);

	const loadHistory = async () => {
		const h = await getClipboardHistory();
		setHistory(h);
	};

	const handleToggle = async (checked: boolean) => {
		await updateClipboardSettings(checked);
		setEnabled(checked);
		setServiceState('clipboard', checked);
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
			<ClipboardHeader 
				enabled={enabled}
				onToggle={handleToggle}
				search={search}
				onSearchChange={setSearch}
				onClear={handleClear}
			/>

			<div style={styles.list}>
				{filteredHistory.length > 0 ? (
					filteredHistory.map((item) => (
						<ClipboardItem 
							key={item.id}
							item={item}
							isNew={newIds.has(item.id)}
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
