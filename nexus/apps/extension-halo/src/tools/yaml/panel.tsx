// goal: YAML panel UI - YAML/JSON bidirectional conversion

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { YamlMode } from './types';
import { parseYaml, jsonToYaml } from './core';
import { styles } from './panel.styles';

export const YamlPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<YamlMode>('yaml-to-json');
	const [input, setInput] = useState('');
	const [output, setOutput] = useState('');
	const [error, setError] = useState('');

	// Convert
	const handleConvert = useCallback(() => {
		setError('');
		const result = mode === 'yaml-to-json' ? parseYaml(input) : jsonToYaml(input);
		if (result.success) {
			setOutput(result.output);
		} else {
			setError(result.error || 'Conversion failed');
			setOutput('');
		}
	}, [mode, input]);

	// Copy output
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	// Swap
	const handleSwap = useCallback(() => {
		setMode((m) => (m === 'yaml-to-json' ? 'json-to-yaml' : 'yaml-to-json'));
		setInput(output);
		setOutput('');
		setError('');
	}, [output]);

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button
					style={{ ...styles.tab, ...(mode === 'yaml-to-json' ? styles.active : styles.inactive) }}
					onClick={() => { setMode('yaml-to-json'); setOutput(''); setError(''); }}
				>
					YAML → JSON
				</button>
				<button
					style={{ ...styles.tab, ...(mode === 'json-to-yaml' ? styles.active : styles.inactive) }}
					onClick={() => { setMode('json-to-yaml'); setOutput(''); setError(''); }}
				>
					JSON → YAML
				</button>
			</div>

			{/* Input */}
			<div>
				<span style={styles.label}>{mode === 'yaml-to-json' ? 'YAML' : 'JSON'}</span>
				<textarea
					style={styles.textarea}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={mode === 'yaml-to-json' ? t('yaml.pasteYaml') : t('yaml.pasteJson')}
				/>
			</div>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleConvert}>{t('yaml.convert')}</button>
				{output && <button style={styles.btnSecondary} onClick={handleSwap}>⇄ {t('yaml.swap')}</button>}
				{output && <button style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>

			{/* Error */}
			{error && <div style={styles.error}>⚠️ {error}</div>}

			{/* Output */}
			{output && (
				<div>
					<span style={styles.label}>{mode === 'yaml-to-json' ? 'JSON' : 'YAML'}</span>
					<textarea style={styles.textarea} value={output} readOnly />
				</div>
			)}
		</div>
	);
};
