import type React from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { styles } from './panel.styles';

interface ClipboardHeaderProps {
	enabled: boolean;
	onToggle: (checked: boolean) => void;
	search: string;
	onSearchChange: (value: string) => void;
	onClear: () => void;
}

export const ClipboardHeader: React.FC<ClipboardHeaderProps> = ({
	enabled,
	onToggle,
	search,
	onSearchChange,
	onClear
}) => {
	const { t } = useTranslation();

	return (
		<Card variant="default" padding="none">
			<div style={{ 
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				padding: '12px', 
				borderBottom: '1px solid var(--halo-border)',
				background: enabled ? 'rgba(76, 175, 80, 0.08)' : undefined,
				transition: 'background 0.3s ease'
			}}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '14px', fontWeight: 600 }}>🚀 {t('clipboardPanel.enable')}</span>
						{enabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }}></span>}
					</div>
					<span style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{t('clipboardPanel.enableDesc')}</span>
				</div>
				<Toggle checked={enabled} onChange={onToggle} />
			</div>
			<div style={{ ...styles.searchBar, padding: '8px 12px' }}>
				<input 
					style={styles.input}
					placeholder={t('clipboardPanel.searchPlaceholder')}
					value={search}
					onChange={(e) => onSearchChange(e.target.value)}
				/>
				<button type="button"
					style={styles.clearBtn}
					onClick={onClear}
					title={t('clipboardPanel.clearUnpinned')}
				>
					🗑️
				</button>
			</div>
		</Card>
	);
};
