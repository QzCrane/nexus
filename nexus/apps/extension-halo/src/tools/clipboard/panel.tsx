// goal: Clipboard tool panel UI with i18n support

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import { 
	getClipboardHistory, 
	togglePin, 
	deleteItem, 
	clearUnpinned, 
	copyToClipboard 
} from './core';
import { ClipboardItem } from './types';

const logger = createLogger('Clipboard', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		height: '100%',
	},
	searchBar: {
		display: 'flex',
		gap: '8px',
		padding: '2px',
	},
	input: {
		flex: 1,
		padding: '10px 14px',
		background: 'var(--halo-bg-secondary, #252525)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		color: 'var(--halo-text, #fff)',
		fontSize: '13px',
		outline: 'none',
		transition: 'border-color 0.2s, box-shadow 0.2s',
	},
	clearBtn: {
		padding: '8px 14px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		color: 'var(--halo-text-secondary, #aaa)',
		fontSize: '14px',
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: '10px',
		overflowY: 'auto',
		flex: 1,
		paddingRight: '4px',
	},
	item: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		padding: '14px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		borderRadius: '12px',
		border: '1px solid var(--halo-border, #333)',
		transition: 'transform 0.15s, box-shadow 0.2s, border-color 0.2s',
		cursor: 'default',
		position: 'relative',
	},
	pinnedItem: {
		borderColor: 'var(--halo-accent, #7c3aed)',
		background: 'linear-gradient(145deg, var(--halo-bg-tertiary), rgba(124, 58, 237, 0.08))',
	},
	itemHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		fontSize: '10px',
		color: 'var(--halo-text-muted, #888)',
	},
	pinnedBadge: {
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
		padding: '2px 8px',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '10px',
		fontSize: '9px',
		fontWeight: 600,
		color: '#fff',
	},
	itemText: {
		fontSize: '13px',
		color: 'var(--halo-text, #e0e0e0)',
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		display: '-webkit-box',
		WebkitLineClamp: 3,
		WebkitBoxOrient: 'vertical',
		overflow: 'hidden',
		lineHeight: '1.6',
	},
	itemFooter: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginTop: '4px',
	},
	source: {
		fontSize: '10px',
		color: 'var(--halo-text-muted, #666)',
		maxWidth: '140px',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	actions: {
		display: 'flex',
		gap: '6px',
	},
	actionBtn: {
		padding: '6px 10px',
		background: 'var(--halo-bg-secondary, #222)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '8px',
		fontSize: '12px',
		color: 'var(--halo-text-secondary, #aaa)',
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
	},
	copyBtn: {
		background: 'var(--halo-accent, #7c3aed)',
		color: '#fff',
		border: 'none',
		fontWeight: 500,
	},
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '16px',
		padding: '48px 20px',
		color: 'var(--halo-text-muted, #666)',
		textAlign: 'center',
	},
	emptyIcon: {
		fontSize: '48px',
		opacity: 0.3,
	},
	emptyText: {
		fontSize: '13px',
		lineHeight: '1.5',
	},
	toast: {
		position: 'fixed',
		bottom: '60px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '24px',
		fontSize: '12px',
		fontWeight: 500,
		color: '#fff',
		zIndex: 1000,
		boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
		animation: 'fadeInUp 0.3s ease-out',
	},
};

export const ClipboardPanel: React.FC = () => {
	const { t } = useTranslation();
	const [history, setHistory] = useState<ClipboardItem[]>([]);
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

	const formatTime = (ts: number) => {
		const now = Date.now();
		const diff = now - ts;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		
		return new Date(ts).toLocaleDateString();
	};

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
						<div 
							key={item.id} 
							style={{
								...styles.item,
								...(item.pinned ? styles.pinnedItem : {})
							}}
						>
							<div style={styles.itemHeader}>
								<span>{formatTime(item.timestamp)}</span>
								{item.pinned && (
									<span style={styles.pinnedBadge}>
										📌 {t('clipboardPanel.pinned')}
									</span>
								)}
							</div>
							<div style={styles.itemText} title={item.text}>
								{item.text}
							</div>
							<div style={styles.itemFooter}>
								<div style={styles.source} title={item.sourceUrl}>
									{item.sourceTitle || item.sourceUrl || t('clipboardPanel.unknownSource')}
								</div>
								<div style={styles.actions}>
									<button 
										style={styles.actionBtn} 
										onClick={() => handlePin(item.id)}
										title={item.pinned ? t('clipboardPanel.unpin') : t('clipboardPanel.pin')}
									>
										{item.pinned ? '📍' : '📌'}
									</button>
									<button 
										style={styles.actionBtn} 
										onClick={() => handleDelete(item.id)}
										title={t('clipboardPanel.delete')}
									>
										🗑️
									</button>
									<button 
										style={{ ...styles.actionBtn, ...styles.copyBtn }} 
										onClick={() => handleCopy(item.text)}
									>
										📋 {t('clipboardPanel.copy')}
									</button>
								</div>
							</div>
						</div>
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
