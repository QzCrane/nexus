// goal: CSV Viewer panel UI - parse and display CSV

import type React from 'react';
import { useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ParsedCsv } from './types';
import { parseCsv, detectDelimiter } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CsvViewerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('csv-viewer-input', '');
	const [delimiter, setDelimiter] = useToolState<string>('csv-viewer-delim', ',');


	// Parse CSV
	const parsed = useMemo<ParsedCsv | null>(() => {
		if (!input.trim()) return null;
		return parseCsv(input, delimiter);
	}, [input, delimiter]);

	// Auto-detect delimiter
	const handleAutoDetect = useCallback(() => {
		if (input) {
			setDelimiter(detectDelimiter(input));
		}
	}, [input, setDelimiter]);

	// Copy as JSON
	const handleCopyJson = useCallback(() => {
		if (!parsed) return;
		const json = parsed.rows.map((row) => {
			const obj: Record<string, string> = {};
			parsed.headers.forEach((h, i) => { obj[h] = row[i] || ''; });
			return obj;
		});
		navigator.clipboard.writeText(JSON.stringify(json, null, 2));
	}, [parsed]);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<textarea
				style={styles.textarea}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder={t('csvViewer.placeholder')}
			/>

			{/* Controls */}
			<div style={styles.row}>
				<select style={styles.select} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
					<option value=",">, ({t('csvViewer.comma', { defaultValue: 'Comma' })})</option>
					<option value=";">; ({t('csvViewer.semicolon', { defaultValue: 'Semicolon' })})</option>
					<option value="	">{t('csvViewer.tab', { defaultValue: 'Tab' })}</option>
					<option value="|">| ({t('csvViewer.pipe', { defaultValue: 'Pipe' })})</option>
				</select>
				<button type="button" style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleAutoDetect}>
					🔍 {t('csvViewer.auto', { defaultValue: 'Auto' })}
				</button>
				{parsed && (
					<>
						<button type="button" style={styles.btn} onClick={handleCopyJson}>📋 {t('csvViewer.copyJson', { defaultValue: 'Copy JSON' })}</button>
						<span style={styles.stats}>{parsed.rowCount} {t('csvViewer.rowsCols', { defaultValue: 'rows × cols' }).split('×')[0]} × {parsed.colCount} {t('csvViewer.rowsCols', { defaultValue: 'rows × cols' }).split('×')[1]}</span>
					</>
				)}
			</div>

			{/* Table */}
			{parsed && parsed.headers.length > 0 ? (
				<Card variant="default" padding="none">
					<div style={styles.tableWrap}>
						<table style={styles.table}>
							<thead>
								<tr>
									{parsed.headers.map((h, i) => {
										// biome-ignore lint/suspicious/noArrayIndexKey: CSV columns have no identity beyond their fixed source coordinate.
										return <th key={i} style={styles.th}>{h || `Col ${i + 1}`}</th>;
									})}
								</tr>
							</thead>
							<tbody>
								{parsed.rows.slice(0, 100).map((row, i) => {
									// biome-ignore lint/suspicious/noArrayIndexKey: CSV rows are an immutable preview whose source row coordinate is the identity.
									return <tr key={i}>
										{row.map((cell, j) => {
											// biome-ignore lint/suspicious/noArrayIndexKey: CSV cells are identified by their fixed column coordinate within this row.
											return <td key={j} style={styles.td}>{cell}</td>;
										})}
									</tr>;
								})}
							</tbody>
						</table>
						{parsed.rowCount > 100 && (
							<div style={{ ...styles.empty, padding: '12px' }}>
								{t('csvViewer.showing100')} ({parsed.rowCount - 100} more)
							</div>
						)}
					</div>
				</Card>
			) : (
				<div style={styles.empty}>📊 {t('csvViewer.empty')}</div>
			)}
		</div>
	);
};
