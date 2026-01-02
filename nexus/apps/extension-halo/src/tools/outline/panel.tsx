// goal: Outline tool panel UI with i18n support
// eff: Styles and component extracted

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { HeadingItem as HeadingItemType, OutlineSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
	extractHeadings,
	scrollToHeading,
	outlineToMarkdown,
	copyToClipboard,
} from './core';
import { styles } from './panel.styles';
import { HeadingItem } from './HeadingItem';
import { useToolState } from '../../kernel';


const logger = createLogger('Outline', 'HALO');

export const OutlinePanel: React.FC = () => {
	const { t } = useTranslation();
	const [headings, setHeadings] = useState<HeadingItemType[]>([]);
	const [settings, setSettings] = useToolState<OutlineSettings>('outline-settings' as any, DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(false);
	const [toast, setToast] = useState<string | null>(null);


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
		showToast(ok ? t('outlinePanel.exported') : t('outlinePanel.copyFailed'));
	}, [headings, settings.showNumbers, showToast, t]);

	const handleSettingChange = useCallback(async <K extends keyof OutlineSettings>(
		key: K,
		value: OutlineSettings[K]
	) => {
		setSettings(prev => ({ ...prev, [key]: value }));
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
					<span>{t('outlinePanel.levels')}</span>
					<select
						value={settings.minLevel}
						onChange={(e) => handleSettingChange('minLevel', parseInt(e.target.value))}
						style={styles.select}
					>
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<option key={n} value={n}>H{n}</option>
						))}
					</select>
					<span>{t('outlinePanel.to')}</span>
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
						{t('outlinePanel.numbers')}
					</label>
				</div>
			</Card>

			<div style={styles.actionRow}>
				<button
					style={{ ...styles.btn, ...styles.primaryBtn }}
					onClick={handleExtract}
					disabled={loading}
				>
					{loading ? t('outlinePanel.extracting') : `🔄 ${t('outlinePanel.refresh')}`}
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
							<HeadingItem
								key={h.id}
								heading={h}
								index={i}
								onClick={handleHeadingClick}
								title={t('outlinePanel.jumpTo')}
							/>
						))}
					</div>
					<div style={styles.stats}>
						{headings.length} {t('outlinePanel.headingStats')} • 
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
