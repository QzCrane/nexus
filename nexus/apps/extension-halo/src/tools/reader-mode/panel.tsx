// goal: Reader Mode panel UI - extract and display readable content

import type React from 'react';
import { useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ReaderConfig, ArticleContent } from './types';
import { articleContentCodec, extractArticle, DEFAULT_CONFIG, FONTS, readerConfigCodec, sanitizeHtml, THEMES } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const ReaderModePanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig, , configRecovery] = useToolState<ReaderConfig>('reader-mode-config', DEFAULT_CONFIG, { codec: readerConfigCodec });
	const [article, setArticle, , articleRecovery] = useToolState<ArticleContent | null>('reader-mode-article', null, { codec: articleContentCodec });

	const task = useOwnedAsyncTask();

	// Extract article
	const handleExtract = useCallback(async () => {
		const outcome = await task.run(() => extractArticle());
		if (outcome.kind === 'succeeded') setArticle(outcome.value);
	}, [setArticle, task.run]);

	// Get theme colors
	const theme = THEMES[config.theme];

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={configRecovery} emptyValue={DEFAULT_CONFIG} exportName="halo-reader-config-damaged.json" />
			<StorageRecoveryActions recovery={articleRecovery} emptyValue={null} exportName="halo-reader-article-damaged.json" />
			{/* Extract Button */}
			<button type="button" style={styles.btn} onClick={handleExtract} disabled={task.phase === 'running'}>
				{task.phase === 'running' ? '⏳' : '📖'} {t('readerMode.extract')}
			</button>
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}

			{/* Config */}
			<Card variant="default" padding="sm">
				{/* Theme */}
				<div style={styles.row}>
					{Object.entries(THEMES).map(([key, th]) => (
						<button
							type="button"
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
						onChange={(e) => setConfig((c) => ({ ...c, fontSize: parseInt(e.target.value, 10) }))}
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
						background: theme.bg,
						color: theme.text,
						fontSize: `${config.fontSize}px`,
						lineHeight: config.lineHeight,
						fontFamily: config.fontFamily,
					}}
				>
					<div style={styles.previewTitle}>{article.title}</div>
				{article.byline && <div style={styles.previewMeta}>{article.byline} • {article.siteName}</div>}
				{/* rule: sanitize after slicing — slice(0,2000) may split a tag mid-attribute
			     and reintroduce an onX/javascript: fragment the core.ts cleanup already
			     stripped. Re-run sanitizeHtml on the sliced string before injection. */}
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via sanitizeHtml() above */}
			<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.content.slice(0, 2000)) }} />
					{article.content.length > 2000 && <div style={{ opacity: 0.5, marginTop: '12px' }}>...</div>}
				</div>
			)}

			{!article && task.phase !== 'running' && (
				<div style={styles.empty}>
					📝 {t('readerMode.clickToExtract')}
				</div>
			)}
		</div>
	);
};
