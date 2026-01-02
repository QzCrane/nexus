// goal: CSV Viewer panel UI - parse and display CSV

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ParsedCsv } from './types';
import { parseCsv, toCsv, detectDelimiter } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CsvViewerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('csv-viewer-input' as any, '');
	const [delimiter, setDelimiter] = useToolState<string>('csv-viewer-delim' as any, ',');


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
	}, [input]);

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
					<option value=",">, (Comma)</option>
					<option value=";">; (Semicolon)</option>
					<option value="	">Tab</option>
					<option value="|">| (Pipe)</option>
				</select>
				<button style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleAutoDetect}>
					🔍 Auto
				</button>
				{parsed && (
					<>
						<button style={styles.btn} onClick={handleCopyJson}>📋 JSON</button>
						<span style={styles.stats}>{parsed.rowCount} rows × {parsed.colCount} cols</span>
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
									{parsed.headers.map((h, i) => <th key={i} style={styles.th}>{h || `Col ${i + 1}`}</th>)}
								</tr>
							</thead>
							<tbody>
								{parsed.rows.slice(0, 100).map((row, i) => (
									<tr key={i}>
										{row.map((cell, j) => <td key={j} style={styles.td}>{cell}</td>)}
									</tr>
								))}
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
