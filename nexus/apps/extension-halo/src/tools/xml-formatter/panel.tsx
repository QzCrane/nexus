// goal: XML Formatter panel UI - format and validate XML

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { XmlResult } from './types';
import { formatXml, minifyXml } from './core';
import { styles } from './panel.styles';

export const XmlFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [indent, setIndent] = useState(2);

	// Parse result
	const result = useMemo<XmlResult | null>(() => {
		if (!input.trim()) return null;
		return formatXml(input, indent);
	}, [input, indent]);

	// Format
	const handleFormat = useCallback(() => {
		const res = formatXml(input, indent);
		if (res.valid) setInput(res.formatted);
	}, [input, indent]);

	// Minify
	const handleMinify = useCallback(() => {
		const res = minifyXml(input);
		if (res.valid) setInput(res.formatted);
	}, [input]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(input);
	}, [input]);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<textarea
				style={styles.textarea}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder={t('xmlFormatter.placeholder')}
			/>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleFormat}>✨ {t('xmlFormatter.format')}</button>
				<button style={styles.btnSecondary} onClick={handleMinify}>{t('xmlFormatter.minify')}</button>
				<button style={styles.btnSecondary} onClick={handleCopy}>📋</button>
				<select
					style={{ ...styles.btnSecondary, cursor: 'pointer' }}
					value={indent}
					onChange={(e) => setIndent(parseInt(e.target.value))}
				>
					<option value={2}>2 spaces</option>
					<option value={4}>4 spaces</option>
				</select>
			</div>

			{/* Error */}
			{result && !result.valid && result.error && (
				<div style={styles.error}>{result.error}</div>
			)}

			{/* Stats */}
			{result && (
				<div style={styles.stats}>
					<div style={styles.stat}>
						<span style={{ ...styles.statValue, ...(result.valid ? styles.valid : styles.invalid) }}>
							{result.valid ? '✓' : '✗'}
						</span>
						<span style={styles.statLabel}>{result.valid ? t('xmlFormatter.valid') : t('xmlFormatter.invalid')}</span>
					</div>
					<div style={styles.stat}>
						<span style={styles.statValue}>{result.stats.elements}</span>
						<span style={styles.statLabel}>{t('xmlFormatter.elements')}</span>
					</div>
					<div style={styles.stat}>
						<span style={styles.statValue}>{result.stats.attributes}</span>
						<span style={styles.statLabel}>{t('xmlFormatter.attributes')}</span>
					</div>
				</div>
			)}
		</div>
	);
};
