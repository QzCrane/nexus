// goal: JSON to CSV panel UI

import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';
import { csvExportModeCodec, type CsvExportMode } from '../csv-viewer/core';
import { jsonToCsv, parseJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const JsonToCsvPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('json-to-csv-input', '');
	const [delimiter, setDelimiter] = useToolState<string>('json-to-csv-delim', ',');
	const [exportMode, setExportMode, , exportModeRecovery] = useToolState<CsvExportMode>('json-to-csv-export-mode', 'raw', { codec: csvExportModeCodec });


	const { output, error } = useMemo(() => {
		if (!input.trim()) return { output: '', error: null };
		const { data, error: parseError } = parseJson(input);
		if (parseError) return { output: '', error: parseError };
		if (data === undefined || data === null) {
			return { output: '', error: 'JSON input produced no data' };
		}
		return { output: jsonToCsv(data, delimiter, exportMode), error: null };
	}, [input, delimiter, exportMode]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	const handleDownload = useCallback(() => {
		const blob = new Blob([output], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'data.csv';
		a.click();
		URL.revokeObjectURL(url);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={exportModeRecovery} emptyValue="raw" exportName="halo-json-to-csv-mode-damaged.json" />
			<div style={styles.label}>{t('jsonToCsv.input')}</div>
			<textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder='[{"name":"John","age":30},...]' />

			<div style={styles.row}>
				<span style={styles.label}>{t('jsonToCsv.delimiter')}</span>
				<select style={styles.select} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
					<option value=",">,</option>
					<option value=";">;</option>
					<option value="\t">Tab</option>
				</select>
			</div>

			<div style={styles.row}>
				<span style={styles.label}>{t('jsonToCsv.exportMode')}</span>
				<select
					style={styles.select}
					value={exportMode}
					onChange={(event) => setExportMode(event.target.value === 'spreadsheet-safe' ? 'spreadsheet-safe' : 'raw')}
				>
					<option value="raw">{t('jsonToCsv.raw')}</option>
					<option value="spreadsheet-safe">{t('jsonToCsv.spreadsheetSafe')}</option>
				</select>
			</div>
			<div style={styles.notice}>
				{t(exportMode === 'raw' ? 'jsonToCsv.rawNotice' : 'jsonToCsv.safeNotice')}
			</div>

			{error && <div style={styles.error}>❌ {error}</div>}

			{output && (
				<>
					<div style={styles.label}>{t('jsonToCsv.output')}</div>
					<textarea style={styles.textarea} value={output} readOnly />
					<div style={styles.row}>
						<button type="button" style={styles.btn} onClick={handleCopy}>📋 {t('jsonToCsv.copy')}</button>
						<button type="button" style={styles.btn} onClick={handleDownload}>⬇️ {t('jsonToCsv.download')}</button>
					</div>
				</>
			)}
		</div>
	);
};
