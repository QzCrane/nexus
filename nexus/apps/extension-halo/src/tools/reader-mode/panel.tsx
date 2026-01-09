// goal: Reader Mode panel UI - extract and display readable content

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ReaderConfig, ArticleContent } from './types';
import { extractArticle, DEFAULT_CONFIG, THEMES, FONTS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const ReaderModePanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<ReaderConfig>('reader-mode-config' as any, DEFAULT_CONFIG);
	const [article, setArticle] = useToolState<ArticleContent | null>('reader-mode-article' as any, null);

	const [loading, setLoading] = useState(false);

	// Extract article
	const handleExtract = useCallback(async () => {
		setLoading(true);
		const content = await extractArticle();
		setArticle(content);
		setLoading(false);
	}, []);

	// Get theme colors
	const theme = THEMES[config.theme];

	return (
		<div style={styles.wrapper}>
			{/* Extract Button */}
			<button style={styles.btn} onClick={handleExtract} disabled={loading}>
				{loading ? '⏳' : '📖'} {t('readerMode.extract')}
			</button>

			{/* Config */}
			<Card variant="default" padding="sm">
				{/* Theme */}
				<div style={styles.row}>
					{Object.entries(THEMES).map(([key, th]) => (
						<button
							key={key}
							style={{
								...styles.themeBtn,
								background: th.bg,
								color: th.text,
								borderColor: config.theme === key ? th.accent : 'transparent',
							}}
							onClick={() => setConfig((c) => ({ ...c, theme: key as ReaderConfig['theme'] }))}
						>
							{key.charAt(0).toUpperCase() + key.slice(1)}
						</button>
					))}
				</div>

				{/* Font Size */}
				<div style={{ ...styles.slider, marginTop: '12px' }}>
					<span style={styles.label}>{t('readerMode.fontSize')}</span>
					<input
						type="range"
						min={14}
						max={28}
						value={config.fontSize}
						onChange={(e) => setConfig((c) => ({ ...c, fontSize: parseInt(e.target.value) }))}
						style={{ flex: 1 }}
					/>
					<span style={{ ...styles.label, width: '30px', textAlign: 'right' }}>{config.fontSize}</span>
				</div>

				{/* Font Family */}
				<div style={{ ...styles.row, marginTop: '12px' }}>
					<span style={styles.label}>{t('readerMode.font')}</span>
					<select
						style={styles.select}
						value={config.fontFamily}
						onChange={(e) => setConfig((c) => ({ ...c, fontFamily: e.target.value }))}
					>
						{FONTS.map((f) => (
							<option key={f.id} value={f.id}>{f.name}</option>
						))}
					</select>
				</div>
			</Card>

			{/* Preview */}
			{article && (
				<div
					style={{
						...styles.preview,
						background: theme!.bg,
						color: theme!.text,
						fontSize: `${config.fontSize}px`,
						lineHeight: config.lineHeight,
						fontFamily: config.fontFamily,
					}}
				>
					<div style={styles.previewTitle}>{article.title}</div>
					{article.byline && <div style={styles.previewMeta}>{article.byline} • {article.siteName}</div>}
					<div dangerouslySetInnerHTML={{ __html: article.content.slice(0, 2000) }} />
					{article.content.length > 2000 && <div style={{ opacity: 0.5, marginTop: '12px' }}>...</div>}
				</div>
			)}

			{!article && !loading && (
				<div style={styles.empty}>
					📝 {t('readerMode.clickToExtract')}
				</div>
			)}
		</div>
	);
};
