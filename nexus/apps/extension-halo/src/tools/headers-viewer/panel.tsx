// goal: Headers Viewer panel UI - display HTTP headers

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { HeaderInfo } from './types';
import { fetchHeaders, getCurrentTabUrl, CATEGORY_COLORS, headerListCodec } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';


export const HeadersViewerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [url, setUrl] = useToolState<string>('headers-viewer-url', '');
	const [headers, setHeaders] = useToolState<HeaderInfo[]>('headers-viewer-list', [], { codec: headerListCodec });
	const [error, setError] = useState<string | null>(null);
	const task = useOwnedAsyncTask();
	const loading = task.phase === 'running';

	// Load current tab URL
	useEffect(() => {
		getCurrentTabUrl().then((u) => {
			if (u && !u.startsWith('chrome://')) setUrl(u);
		});
	}, [setUrl]);

	// Fetch headers
	const handleFetch = useCallback(async () => {
		if (!url) return;
		setError(null);
		const controller = new AbortController();
		const outcome = await task.run(() => ({
			promise: fetchHeaders(url, { signal: controller.signal }),
			dispose: () => controller.abort(),
		}), 31_000);
		if (outcome.kind === 'succeeded') setHeaders(outcome.value);
		else if (outcome.kind === 'failed') setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
		else if (outcome.reason === 'deadline') setError('Header request deadline exceeded');
	}, [url, setHeaders, task.run]);

	// Copy all headers
	const handleCopy = useCallback(() => {
		const text = headers.map((h) => `${h.name}: ${h.value}`).join('\n');
		navigator.clipboard.writeText(text);
	}, [headers]);

	return (
		<div style={styles.wrapper}>
			{error && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{error}</div>}
			{/* URL Input */}
			<div style={styles.row}>
				<input
					style={styles.input}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder={t('headersViewer.placeholder')}
					onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
				/>
				<button type="button" style={styles.btn} onClick={handleFetch} disabled={loading}>
					{loading ? '⏳' : '🔍'}
				</button>
			</div>

			{/* Results */}
			{loading ? (
				<div style={styles.loading}>⏳ {t('headersViewer.loading')}</div>
			) : headers.length === 0 ? (
				<div style={styles.empty}>📋 {t('headersViewer.empty')}</div>
			) : (
				<>
					<div style={styles.row}>
						<span style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{headers.length} headers</span>
						<button type="button" style={{ ...styles.btn, padding: '6px 12px', background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleCopy}>📋</button>
					</div>
					<div style={styles.list}>
						{headers.map((h) => (
							<div key={h.name} style={styles.item}>
								<div style={{ display: 'flex', alignItems: 'center' }}>
									<span style={styles.name}>{h.name}</span>
									<span style={{ ...styles.tag, background: CATEGORY_COLORS[h.category] }}>{h.category}</span>
								</div>
								<span style={styles.value}>{h.value}</span>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
};
