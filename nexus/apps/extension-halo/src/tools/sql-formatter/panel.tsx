// goal: SQL Formatter panel UI

import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { formatSql, minifySql, validateSql } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const SqlFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('sql-formatter', '');


	const validation = useMemo(() => validateSql(input), [input]);

	const handleFormat = useCallback(() => {
		setInput(formatSql(input));
	}, [input, setInput]);

	const handleMinify = useCallback(() => {
		setInput(minifySql(input));
	}, [input, setInput]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(input);
	}, [input]);

	return (
		<div style={styles.wrapper}>
			<textarea
				style={styles.textarea}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder="SELECT * FROM users WHERE id = 1"
			/>

			{/* Validation status */}
			{input && (
				<div style={{ ...styles.status, ...(validation.valid ? styles.valid : styles.invalid) }}>
					{validation.valid ? '✅' : '❌'} {validation.message}
				</div>
			)}

			{/* Actions */}
			<div style={styles.row}>
				<button type="button" style={styles.btn} onClick={handleFormat}>✨ {t('sql.format')}</button>
				<button type="button" style={styles.btnSecondary} onClick={handleMinify}>📦 {t('sql.minify')}</button>
			</div>

			<button type="button" style={styles.btnSecondary} onClick={handleCopy}>📋 {t('sql.copy')}</button>
		</div>
	);
};
