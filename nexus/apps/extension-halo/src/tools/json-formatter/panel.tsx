// goal: JSON Formatter tool panel UI with Tree View and JSONPath support

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import {
	formatJSON,
	minifyJSON,
	validateJSON,
	copyToClipboard,
} from './core';
import { useToolState } from '../../kernel';

import { styles } from './panel.styles';

const logger = createLogger('JSONFormatter', 'HALO');

// Lightweight Recursive Tree View Component
const JsonTree: React.FC<{ data: any; label?: string; depth?: number }> = ({ data, label, depth = 0 }) => {
	const [collapsed, setCollapsed] = useState(depth > 1);
	const isObject = data !== null && typeof data === 'object';
	const type = Array.isArray(data) ? 'array' : typeof data;

	if (!isObject) {
		return (
			<div style={{ marginLeft: '16px', fontSize: '12px', padding: '2px 0' }}>
				{label && <span style={{ color: 'var(--halo-accent)' }}>{label}: </span>}
				<span style={{ color: type === 'string' ? '#ce9178' : '#b5cea8' }}>
					{type === 'string' ? `"${data}"` : String(data)}
				</span>
			</div>
		);
	}

	const keys = Object.keys(data);
	const isEmpty = keys.length === 0;

	return (
		<div style={{ marginLeft: depth > 0 ? '16px' : '0', fontSize: '12px' }}>
			<div 
				onClick={() => !isEmpty && setCollapsed(!collapsed)} 
				style={{ cursor: isEmpty ? 'default' : 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '4px' }}
			>
				{!isEmpty && <span style={{ fontSize: '10px', opacity: 0.6 }}>{collapsed ? '▶' : '▼'}</span>}
				{label && <span style={{ color: 'var(--halo-accent)' }}>{label}</span>}
				<span style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>
					{Array.isArray(data) ? `[ ${keys.length} ]` : `{ ${keys.length} }`}
				</span>
			</div>
			{!collapsed && !isEmpty && (
				<div style={{ borderLeft: '1px solid var(--halo-border)', marginLeft: '4px' }}>
					{keys.map(key => (
						<JsonTree key={key} data={data[key]} label={key} depth={depth + 1} />
					))}
				</div>
			)}
		</div>
	);
};

export const JSONFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('json-formatter', '');
	const [error, setError] = useState<string | null>(null);
	const [options, setOptions] = useToolState<FormatOptions>('json-formatter-opts' as any, DEFAULT_OPTIONS);
	const [toast, setToast] = useState<string | null>(null);


	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleFormat = useCallback(() => {
		const result = formatJSON(input, options);
		if (result.success) { setInput(result.output); setError(null); showToast(t('jsonPanel.formatted')); }
		else { setError(result.error || t('jsonPanel.invalidJson')); }
	}, [input, options, showToast, t]);

	const handleMinify = useCallback(() => {
		const result = minifyJSON(input);
		if (result.success) { setInput(result.output); setError(null); showToast(t('jsonPanel.minified')); }
		else { setError(result.error || t('jsonPanel.invalidJson')); }
	}, [input, showToast, t]);

	const handleDownload = useCallback(() => {
		const blob = new Blob([input], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `data-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}, [input]);

	const parsedData = useMemo(() => {
		if (!options.showTree || !input.trim()) return null;
		try { return JSON.parse(input); } catch { return null; }
	}, [input, options.showTree]);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.optionsRow}>
					<select value={options.indent} onChange={(e) => setOptions(p => ({ ...p, indent: +e.target.value as any }))} style={styles.select}>
						<option value={2}>2 {t('jsonPanel.spaces')}</option>
						<option value={4}>4 {t('jsonPanel.spaces')}</option>
					</select>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={options.sortKeys} onChange={(e) => setOptions(p => ({ ...p, sortKeys: e.target.checked }))} />
						Sort
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={options.showTree} onChange={(e) => setOptions(p => ({ ...p, showTree: e.target.checked }))} />
						Tree
					</label>
				</div>
			</Card>

			{options.showTree && parsedData ? (
				<div style={{ ...styles.textarea, overflowY: 'auto', background: 'var(--halo-bg-tertiary)', minHeight: '300px' }}>
					<JsonTree data={parsedData} />
				</div>
			) : (
				<textarea
					style={{ ...styles.textarea, ...(error ? styles.errorArea : {}), minHeight: '200px' }}
					placeholder={t('jsonPanel.placeholder')}
					value={input}
					onChange={(e) => { setInput(e.target.value); setError(null); }}
				/>
			)}

			<div style={styles.actionRow}>
				<button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={handleFormat}>✨ Format</button>
				<button style={styles.btn} onClick={handleMinify}>📦 Minify</button>
				<button style={styles.btn} onClick={() => copyToClipboard(input).then(ok => showToast(ok ? 'Copied' : 'Failed'))}>📋 Copy</button>
				<button style={styles.btn} onClick={handleDownload}>💾 Save</button>
				<button style={styles.btn} onClick={() => setInput('')}>🗑️ Clear</button>
			</div>

			<div style={styles.statusBar}>
				<span>{input.length} chars · {input ? input.split('\n').length : 0} lines</span>
				<span style={{ color: error ? '#ef4444' : '#22c55e' }}>{error ? 'Invalid JSON' : 'Valid'}</span>
			</div>
			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
