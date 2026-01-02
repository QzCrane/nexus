// goal: JSONPath panel UI

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { queryJsonPath, EXAMPLE_PATHS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const JsonPathPanel: React.FC = () => {
	const { t } = useTranslation();
	const [json, setJson] = useToolState<string>('json-path-input' as any, '');
	const [path, setPath] = useToolState<string>('json-path-query' as any, '$');


	const { results, error } = useMemo(() => {
		if (!json.trim()) return { results: [], error: null };
		try {
			const data = JSON.parse(json);
			return { results: queryJsonPath(data, path), error: null };
		} catch {
			return { results: [], error: 'Invalid JSON' };
		}
	}, [json, path]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(JSON.stringify(results, null, 2));
	}, [results]);

	return (
		<div style={styles.wrapper}>
			{/* JSON input */}
			<div>
				<div style={styles.label}>JSON</div>
				<textarea style={styles.textarea} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"users":[{"name":"John"}]}' />
			</div>

			{/* Path input */}
			<div>
				<div style={styles.label}>JSONPath</div>
				<input style={styles.input} value={path} onChange={(e) => setPath(e.target.value)} placeholder="$.users[*].name" />
			</div>

			{/* Examples */}
			<div style={styles.examples}>
				{EXAMPLE_PATHS.map((p) => (
					<button key={p} style={styles.example} onClick={() => setPath(p)}>{p}</button>
				))}
			</div>

			{/* Error */}
			{error && <div style={{ color: '#ef4444', fontSize: '12px' }}>❌ {error}</div>}

			{/* Results */}
			{results.length > 0 && (
				<div style={styles.result}>
					<div style={styles.count}>{results.length} {t('jsonPath.matches')}</div>
					<pre style={{ margin: 0, fontSize: '11px', fontFamily: 'monospace', color: 'var(--halo-text)', whiteSpace: 'pre-wrap' }}>
						{JSON.stringify(results, null, 2)}
					</pre>
					<button style={{ marginTop: '8px', ...styles.example }} onClick={handleCopy}>📋 {t('jsonPath.copy')}</button>
				</div>
			)}
		</div>
	);
};
