// goal: CSV to JSON panel UI

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { csvToJson } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CsvToJsonPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('csv-to-json-input' as any, '');
    const [delimiter, setDelimiter] = useToolState<string>('csv-to-json-delim' as any, ',');
    const [hasHeader, setHasHeader] = useToolState<boolean>('csv-to-json-header' as any, true);


	const { output, error } = useMemo(() => {
		if (!input.trim()) return { output: '', error: null };
		try {
            const data = csvToJson(input, { delimiter, hasHeader });
			return { output: JSON.stringify(data, null, 2), error: null };
		} catch (e) {
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
                <div style={styles.label}>CSV Input</div>
			    <textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder="name,age\nJohn,30" />
            </div>

            <div style={styles.row}>
				<span style={styles.label}>Delimiter:</span>
				<select style={styles.select} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
					<option value=",">,</option>
					<option value=";">;</option>
					<option value="\t">Tab</option>
				</select>
                <label style={styles.checkbox}>
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                    Has Header
                </label>
			</div>

            {error && <div style={styles.error}>❌ {error}</div>}

			{output && (
				<div>
					<div style={styles.label}>JSON Output</div>
					<textarea style={styles.textarea} value={output} readOnly />
                    <div style={{...styles.row, marginTop: '8px'}}>
                        <button style={styles.btn} onClick={handleCopy}>📋 Copy JSON</button>
                        <button style={styles.btn} onClick={handleDownload}>⬇️ Download</button>
                    </div>
				</div>
			)}
		</div>
	);
};
