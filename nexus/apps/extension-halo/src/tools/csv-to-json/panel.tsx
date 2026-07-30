// goal: CSV to JSON panel UI

import type React from 'react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { csvToJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CsvToJsonPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('csv-to-json-input', '');
    const [delimiter, setDelimiter] = useToolState<string>('csv-to-json-delim', ',');
    const [hasHeader, setHasHeader] = useToolState<boolean>('csv-to-json-header', true);


	const { output, error } = useMemo(() => {
		if (!input.trim()) return { output: '', error: null };
		try {
            const data = csvToJson(input, { delimiter, hasHeader });
			return { output: JSON.stringify(data, null, 2), error: null };
		} catch (_e) {
			return { output: '', error: 'Error parsing CSV' };
		}
	}, [input, delimiter, hasHeader]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

    const handleDownload = useCallback(() => {
		const blob = new Blob([output], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'data.json';
		a.click();
		URL.revokeObjectURL(url);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<div>
                <div style={styles.label}>{t('csvToJson.input', { defaultValue: 'CSV Input' })}</div>
			    <textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder="name,age\nJohn,30" />
            </div>

            <div style={styles.row}>
				<span style={styles.label}>{t('csvToJson.separator', { defaultValue: 'Separator' })}:</span>
				<select style={styles.select} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
					<option value=",">,</option>
					<option value=";">;</option>
					<option value="\t">{t('csvToJson.tab', { defaultValue: 'Tab' })}</option>
				</select>
                <label style={styles.checkbox}>
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                    {t('csvToJson.header', { defaultValue: 'Has Header' })}
                </label>
			</div>

            {error && <div style={styles.error}>❌ {error}</div>}

			{output && (
				<div>
					<div style={styles.label}>{t('csvToJson.output', { defaultValue: 'JSON Output' })}</div>
					<textarea style={styles.textarea} value={output} readOnly />
                    <div style={{...styles.row, marginTop: '8px'}}>
                        <button type="button" style={styles.btn} onClick={handleCopy}>📋 {t('csvToJson.copy', { defaultValue: 'Copy JSON' })}</button>
                        <button type="button" style={styles.btn} onClick={handleDownload}>⬇️ {t('csvToJson.download', { defaultValue: 'Download' })}</button>
                    </div>
				</div>
			)}
		</div>
	);
};
