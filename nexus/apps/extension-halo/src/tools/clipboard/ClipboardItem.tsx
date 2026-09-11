// goal: Clipboard item component
// eff: Renders single history item

import type React from 'react';
import { useTranslation } from '../../i18n';
import type { ClipboardItem as ClipboardItemType } from './types';
import { styles } from './panel.styles';
import { formatTime } from './utils';

interface ClipboardItemProps {
	item: ClipboardItemType;
	isNew?: boolean;
	onPin: (id: string) => void;
	onDelete: (id: string) => void;
	onCopy: (text: string) => void;
}

export const ClipboardItem: React.FC<ClipboardItemProps> = ({
	item,
	isNew,
	onPin,
	onDelete,
	onCopy,
}) => {
	const { t } = useTranslation();

	return (
		<div
			style={{
				...styles.item,
				...(item.pinned ? styles.pinnedItem : {}),
				...(isNew ? {
					animation: 'var(--halo-motion-animation, flash-green 2s ease-out)',
					borderLeft: '3px solid #4CAF50',
					background: 'rgba(76, 175, 80, 0.08)'
				} : {})
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
					<button type="button"
						style={styles.actionBtn}
						onClick={() => onPin(item.id)}
						title={item.pinned ? t('clipboardPanel.unpin') : t('clipboardPanel.pin')}
					>
						{item.pinned ? '📍' : '📌'}
					</button>
					<button type="button"
						style={styles.actionBtn}
						onClick={() => onDelete(item.id)}
						title={t('clipboardPanel.delete')}
					>
						🗑️
					</button>
					<button type="button"
						style={{ ...styles.actionBtn, ...styles.copyBtn }}
						onClick={() => onCopy(item.text)}
					>
						📋 {t('clipboardPanel.copy')}
					</button>
				</div>
			</div>
		</div>
	);
};
