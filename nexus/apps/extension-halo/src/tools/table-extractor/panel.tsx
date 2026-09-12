// goal: Table Extractor panel UI - extract and export tables

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { csvExportModeCodec, type CsvExportMode } from '../csv-viewer/core';
import type { TableData } from './types';
import { extractTables, tableDataCodec, tableToCsv, tableToJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const TableExtractorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [tables, setTables, , tablesRecovery] = useToolState<TableData[]>('table-extractor-data', [], { codec: tableDataCodec });
	const [error, setError] = useState('');
	const [scanned, setScanned] = useToolState<boolean>('table-extractor-scanned', false);
	const [exportMode, setExportMode, , exportModeRecovery] = useToolState<CsvExportMode>('table-extractor-csv-mode', 'raw', { codec: csvExportModeCodec });
	const { phase, run } = useOwnedAsyncTask();
	const loading = phase === 'running';


	// Extract tables
	const handleExtract = useCallback(() => {
		setError('');
		void run(() => extractTables()).then((outcome) => {
			if (outcome.kind === 'succeeded') {
				setTables(outcome.value);
				setScanned(true);
			} else if (outcome.kind === 'failed') setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
			else if (outcome.reason === 'deadline') setError('Table extraction exceeded the execution deadline.');
		});
	}, [run, setTables, setScanned]);

	// Copy as CSV
	const handleCopyCsv = useCallback((table: TableData) => {
		navigator.clipboard.writeText(tableToCsv(table, exportMode));
	}, [exportMode]);

	// Copy as JSON
	const handleCopyJson = useCallback((table: TableData) => {
		navigator.clipboard.writeText(tableToJson(table));
	}, []);

	// Download CSV
	const handleDownload = useCallback((table: TableData, index: number) => {
		const csv = tableToCsv(table, exportMode);
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `table-${index + 1}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}, [exportMode]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={tablesRecovery} emptyValue={[]} exportName="halo-table-extractor-data-damaged.json" />
			<StorageRecoveryActions recovery={exportModeRecovery} emptyValue="raw" exportName="halo-table-extractor-mode-damaged.json" />
			<div style={styles.exportControl}>
				<span style={styles.label}>{t('tableExtractor.csvMode')}</span>
				<select
					style={styles.select}
					value={exportMode}
					onChange={(event) => setExportMode(event.target.value === 'spreadsheet-safe' ? 'spreadsheet-safe' : 'raw')}
				>
					<option value="raw">{t('tableExtractor.raw')}</option>
					<option value="spreadsheet-safe">{t('tableExtractor.spreadsheetSafe')}</option>
				</select>
			</div>
			<div style={styles.notice}>
				{t(exportMode === 'raw' ? 'tableExtractor.rawNotice' : 'tableExtractor.safeNotice')}
			</div>
			{/* Extract Button */}
			<button type="button" style={styles.btn} onClick={handleExtract} disabled={loading}>
				{loading ? '⏳' : '📋'} {t('tableExtractor.extract')}
			</button>
			{error && <div style={styles.error}>⚠️ {error}</div>}

			{/* Loading */}
			{loading && <div style={styles.loading}>⏳</div>}

			{/* Results */}
			{scanned && !loading && (
				tables.length === 0 ? (
					<div style={styles.empty}>📊 {t('tableExtractor.noTables')}</div>
				) : (
					tables.map((table, i) => {
						// biome-ignore lint/suspicious/noArrayIndexKey: Extracted tables are an immutable DOM-order snapshot, so source position is the table identity.
						return <div key={i} style={styles.tableCard}>
							<div style={styles.tableHeader}>
								<div>
									<div style={styles.tableTitle}>{table.caption || `Table ${i + 1}`}</div>
									<div style={styles.tableInfo}>{table.rows.length} rows × {table.headers.length || table.rows[0]?.length || 0} cols</div>
								</div>
								<div style={styles.actions}>
									<button type="button" style={styles.actionBtn} onClick={() => handleCopyCsv(table)}>CSV</button>
									<button type="button" style={styles.actionBtn} onClick={() => handleCopyJson(table)}>JSON</button>
									<button type="button" style={styles.actionBtn} onClick={() => handleDownload(table, i)}>⬇️</button>
								</div>
							</div>
							<div style={styles.preview}>
								<table style={styles.table}>
									{table.headers.length > 0 && (
										<thead><tr>{table.headers.map((h, j) => {
											// biome-ignore lint/suspicious/noArrayIndexKey: Header cells are identified by their fixed source column coordinate.
											return <th key={j} style={styles.th}>{h}</th>;
										})}</tr></thead>
									)}
									<tbody>
										{table.rows.slice(0, 5).map((row, j) => {
											// biome-ignore lint/suspicious/noArrayIndexKey: Preview rows are identified by their fixed source row coordinate.
											return <tr key={j}>{row.map((cell, k) => {
												// biome-ignore lint/suspicious/noArrayIndexKey: Preview cells are identified by their fixed column coordinate within this row.
												return <td key={k} style={styles.td}>{cell}</td>;
											})}</tr>;
										})}
									</tbody>
								</table>
								{table.rows.length > 5 && (
									<div style={{ textAlign: 'center', padding: '8px', fontSize: '10px', color: 'var(--halo-text-muted)' }}>
										... {table.rows.length - 5} more rows
									</div>
								)}
							</div>
						</div>;
					})
				)
			)}

			{!scanned && <div style={styles.empty}>📊 {t('tableExtractor.clickToExtract')}</div>}
		</div>
	);
};
