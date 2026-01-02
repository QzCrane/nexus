// goal: Table Extractor panel UI - extract and export tables

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { TableData } from './types';
import { extractTables, tableToCsv, tableToJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const TableExtractorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [tables, setTables] = useToolState<TableData[]>('table-extractor-data' as any, []);
	const [loading, setLoading] = useState(false);
	const [scanned, setScanned] = useToolState<boolean>('table-extractor-scanned' as any, false);


	// Extract tables
	const handleExtract = useCallback(async () => {
		setLoading(true);
		const result = await extractTables();
		setTables(result);
		setLoading(false);
		setScanned(true);
	}, []);

	// Copy as CSV
	const handleCopyCsv = useCallback((table: TableData) => {
		navigator.clipboard.writeText(tableToCsv(table));
	}, []);

	// Copy as JSON
	const handleCopyJson = useCallback((table: TableData) => {
		navigator.clipboard.writeText(tableToJson(table));
	}, []);

	// Download CSV
	const handleDownload = useCallback((table: TableData, index: number) => {
		const csv = tableToCsv(table);
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `table-${index + 1}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Extract Button */}
			<button style={styles.btn} onClick={handleExtract} disabled={loading}>
				{loading ? '⏳' : '📋'} {t('tableExtractor.extract')}
			</button>

			{/* Loading */}
			{loading && <div style={styles.loading}>⏳</div>}

			{/* Results */}
			{scanned && !loading && (
				tables.length === 0 ? (
					<div style={styles.empty}>📊 {t('tableExtractor.noTables')}</div>
				) : (
					tables.map((table, i) => (
						<div key={i} style={styles.tableCard}>
							<div style={styles.tableHeader}>
								<div>
									<div style={styles.tableTitle}>{table.caption || `Table ${i + 1}`}</div>
									<div style={styles.tableInfo}>{table.rows.length} rows × {table.headers.length || table.rows[0]?.length || 0} cols</div>
								</div>
								<div style={styles.actions}>
									<button style={styles.actionBtn} onClick={() => handleCopyCsv(table)}>CSV</button>
									<button style={styles.actionBtn} onClick={() => handleCopyJson(table)}>JSON</button>
									<button style={styles.actionBtn} onClick={() => handleDownload(table, i)}>⬇️</button>
								</div>
							</div>
							<div style={styles.preview}>
								<table style={styles.table}>
									{table.headers.length > 0 && (
										<thead><tr>{table.headers.map((h, j) => <th key={j} style={styles.th}>{h}</th>)}</tr></thead>
									)}
									<tbody>
										{table.rows.slice(0, 5).map((row, j) => (
											<tr key={j}>{row.map((cell, k) => <td key={k} style={styles.td}>{cell}</td>)}</tr>
										))}
									</tbody>
								</table>
								{table.rows.length > 5 && (
									<div style={{ textAlign: 'center', padding: '8px', fontSize: '10px', color: 'var(--halo-text-muted)' }}>
										... {table.rows.length - 5} more rows
									</div>
								)}
							</div>
						</div>
					))
				)
			)}

			{!scanned && <div style={styles.empty}>📊 {t('tableExtractor.clickToExtract')}</div>}
		</div>
	);
};
