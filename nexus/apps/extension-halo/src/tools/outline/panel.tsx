// goal: Outline tool panel UI with i18n support

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { HeadingItem, OutlineSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
	extractHeadings,
	scrollToHeading,
	outlineToMarkdown,
	copyToClipboard,
	loadSettings,
	saveSettings,
} from './core';

const logger = createLogger('Outline', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	actionRow: {
		display: 'flex',
		gap: '8px',
	},
	btn: {
		flex: 1,
		padding: '12px 14px',
		background: 'var(--halo-bg-tertiary, #333)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		color: 'var(--halo-text, #fff)',
		fontSize: '12px',
		fontWeight: 500,
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '6px',
	},
	primaryBtn: {
		background: 'linear-gradient(135deg, var(--halo-accent, #7c3aed), #4a9eff)',
		border: 'none',
		color: '#fff',
		fontWeight: 600,
	},
	outlineList: {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
		maxHeight: '400px',
		overflowY: 'auto',
	},
	headingItem: {
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		padding: '10px 14px',
		background: 'var(--halo-bg-secondary, #252525)',
		borderRadius: '10px',
		cursor: 'pointer',
		transition: 'background 0.15s, transform 0.1s',
		fontSize: '13px',
		color: 'var(--halo-text, #e0e0e0)',
		border: '1px solid transparent',
	},
	headingLevel: {
		fontSize: '9px',
		fontWeight: 700,
		color: '#fff',
		minWidth: '26px',
		height: '18px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '4px',
	},
	headingText: {
		flex: 1,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	optionsRow: {
		display: 'flex',
		gap: '14px',
		alignItems: 'center',
		fontSize: '12px',
		color: 'var(--halo-text-secondary, #888)',
	},
	select: {
		padding: '6px 10px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '6px',
		color: 'var(--halo-text, #ddd)',
		fontSize: '11px',
		outline: 'none',
	},
	checkbox: {
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
		cursor: 'pointer',
	},
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '40px',
		color: 'var(--halo-text-muted, #666)',
		fontSize: '13px',
		textAlign: 'center',
		gap: '12px',
	},
	emptyIcon: {
		fontSize: '40px',
		opacity: 0.3,
	},
	stats: {
		fontSize: '11px',
		color: 'var(--halo-text-muted, #666)',
		textAlign: 'center',
		padding: '8px 0',
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

export const OutlinePanel: React.FC = () => {
	const { t } = useTranslation();
	const [headings, setHeadings] = useState<HeadingItem[]>([]);
	const [settings, setSettings] = useState<OutlineSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(false);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadSettings().then(setSettings);
	}, []);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleExtract = useCallback(async () => {
		setLoading(true);
		try {
			const extracted = await extractHeadings(settings);
			setHeadings(extracted);
			logger.info('Extracted', extracted.length, 'headings');
		} catch (e) {
			logger.error('Extract failed:', e);
			showToast('Failed to extract headings');
		} finally {
			setLoading(false);
		}
	}, [settings, showToast]);

	const handleHeadingClick = useCallback(async (index: number) => {
		await scrollToHeading(index);
	}, []);

	const handleCopyMarkdown = useCallback(async () => {
		const md = outlineToMarkdown(headings, settings.showNumbers);
		const ok = await copyToClipboard(md);
		showToast(ok ? t('outlinePanel.exported') : 'Copy failed');
	}, [headings, settings.showNumbers, showToast, t]);

	const handleSettingChange = useCallback(async <K extends keyof OutlineSettings>(
		key: K,
		value: OutlineSettings[K]
	) => {
		const updated = await saveSettings({ [key]: value });
		setSettings(updated);
	}, []);

	// Calculate level distribution
	const levelCounts = headings.reduce((acc, h) => {
		acc[h.level] = (acc[h.level] || 0) + 1;
		return acc;
	}, {} as Record<number, number>);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.optionsRow}>
					<span>Levels:</span>
					<select
						value={settings.minLevel}
						onChange={(e) => handleSettingChange('minLevel', parseInt(e.target.value))}
						style={styles.select}
					>
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<option key={n} value={n}>H{n}</option>
						))}
					</select>
					<span>to</span>
					<select
						value={settings.maxLevel}
						onChange={(e) => handleSettingChange('maxLevel', parseInt(e.target.value))}
						style={styles.select}
					>
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<option key={n} value={n}>H{n}</option>
						))}
					</select>
					<label style={styles.checkbox}>
						<input
							type="checkbox"
							checked={settings.showNumbers}
							onChange={(e) => handleSettingChange('showNumbers', e.target.checked)}
						/>
						Numbers
					</label>
				</div>
			</Card>

			<div style={styles.actionRow}>
				<button
					style={{ ...styles.btn, ...styles.primaryBtn }}
					onClick={handleExtract}
					disabled={loading}
				>
					{loading ? '⏳ Extracting...' : `🔄 ${t('outlinePanel.refresh')}`}
				</button>
				{headings.length > 0 && (
					<button style={styles.btn} onClick={handleCopyMarkdown}>
						📝 {t('outlinePanel.exportMd')}
					</button>
				)}
			</div>

			{headings.length > 0 ? (
				<>
					<div style={styles.outlineList}>
						{headings.map((h, i) => (
							<div
								key={h.id}
								style={{
									...styles.headingItem,
									paddingLeft: `${14 + (h.level - 1) * 18}px`,
								}}
								onClick={() => handleHeadingClick(i)}
								title={t('outlinePanel.jumpTo')}
							>
								<span style={styles.headingLevel}>H{h.level}</span>
								<span style={styles.headingText}>{h.text || '(empty)'}</span>
							</div>
						))}
					</div>
					<div style={styles.stats}>
						{headings.length} headings • 
						{Object.entries(levelCounts).map(([lvl, cnt]) => 
							` H${lvl}: ${cnt}`
						).join(' •')}
					</div>
				</>
			) : (
				<div style={styles.empty}>
					<span style={styles.emptyIcon}>📋</span>
					<p>{t('outlinePanel.noHeadings')}</p>
				</div>
			)}

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
