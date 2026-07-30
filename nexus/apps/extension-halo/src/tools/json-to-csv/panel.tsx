// goal: JSON to CSV panel UI

import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { jsonToCsv, parseJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const JsonToCsvPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('json-to-csv-input', '');
	const [delimiter, setDelimiter] = useToolState<string>('json-to-csv-delim', ',');


	const { output, error } = useMemo(() => {
		if (!input.trim()) return { output: '', error: null };
		const { data, error: parseError } = parseJson(input);
		if (parseError) return { output: '', error: parseError };
		if (data === undefined || data === null) {
			return { output: '', error: 'JSON input produced no data' };
		}
		return { output: jsonToCsv(data, delimiter), error: null };
	}, [input, delimiter]);

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
