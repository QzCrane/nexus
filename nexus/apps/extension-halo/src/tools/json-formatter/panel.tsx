// goal: JSON Formatter tool panel UI with Tree View and JSONPath support

import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import {
	formatJSON,
	minifyJSON,
	copyToClipboard,
	formatOptionsCodec,
} from './core';
import { useToolState } from '../../kernel';
import { useToast } from '../../components/ToastProvider';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

import { styles } from './panel.styles';

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Lightweight Recursive Tree View Component
const JsonTree: React.FC<{ data: unknown; label?: string; depth?: number }> = ({ data, label, depth = 0 }) => {
	const [collapsed, setCollapsed] = useState(depth > 1);
	const isArray = isUnknownArray(data);
	const isObject = isArray || isRecord(data);
	const type = isArray ? 'array' : typeof data;

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

	const entries: Array<[string, unknown]> = isArray
		? data.map((value, index) => [String(index), value])
		: Object.entries(data);
	const isEmpty = entries.length === 0;

	return (
		<div style={{ marginLeft: depth > 0 ? '16px' : '0', fontSize: '12px' }}>
			<button
				type="button"
				disabled={isEmpty}
				aria-expanded={isEmpty ? undefined : !collapsed}
				onClick={() => setCollapsed(!collapsed)}
				style={{ width: '100%', cursor: isEmpty ? 'default' : 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '4px', border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left' }}
			>
				{!isEmpty && <span style={{ fontSize: '10px', opacity: 0.6 }}>{collapsed ? '▶' : '▼'}</span>}
				{label && <span style={{ color: 'var(--halo-accent)' }}>{label}</span>}
				<span style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>
					{isArray ? `[ ${entries.length} ]` : `{ ${entries.length} }`}
				</span>
			</button>
			{!collapsed && !isEmpty && (
				<div style={{ borderLeft: '1px solid var(--halo-border)', marginLeft: '4px' }}>
					{entries.map(([key, value]) => (
						<JsonTree key={key} data={value} label={key} depth={depth + 1} />
					))}
				</div>
			)}
		</div>
	);
};

export const JSONFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [input, setInput] = useToolState<string>('json-formatter', '');
	const [error, setError] = useState<string | null>(null);
	const [options, setOptions, , optionsRecovery] = useToolState<FormatOptions>('json-formatter-opts', DEFAULT_OPTIONS, { codec: formatOptionsCodec });

	const handleFormat = useCallback(() => {
		const result = formatJSON(input, options);
		if (result.success) { setInput(result.output); setError(null); showToast(t('jsonPanel.formatted')); }
		else { setError(result.error || t('jsonPanel.invalidJson')); }
	}, [input, options, showToast, t, setInput]);

	const handleMinify = useCallback(() => {
		const result = minifyJSON(input);
		if (result.success) { setInput(result.output); setError(null); showToast(t('jsonPanel.minified')); }
		else { setError(result.error || t('jsonPanel.invalidJson')); }
	}, [input, showToast, t, setInput]);

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
		try {
			const parsed: unknown = JSON.parse(input);
			return parsed;
		} catch {
			return null;
		}
	}, [input, options.showTree]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={optionsRecovery} emptyValue={DEFAULT_OPTIONS} exportName="halo-json-options-damaged.json" />
			<Card variant="default" padding="sm">
				<div style={styles.optionsRow}>
					{/* Indent: button group */}
					<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
						{[2, 4].map((n) => (
							<button
								key={n}
								type="button"
								style={{
									border: 'none',
									background: options.indent === n ? 'var(--halo-accent)' : 'transparent',
									color: options.indent === n ? '#fff' : 'var(--halo-text-muted)',
									padding: '4px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
								}}
								onClick={() => setOptions(p => ({ ...p, indent: n as 2 | 4 }))}
							>
								{n} {t('jsonPanel.spaces')}
							</button>
						))}
					</div>
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
				<button type="button" style={{ ...styles.btn, ...styles.primaryBtn }} onClick={handleFormat}>✨ Format</button>
				<button type="button" style={styles.btn} onClick={handleMinify}>📦 Minify</button>
				<button type="button" style={styles.btn} onClick={() => copyToClipboard(input).then(ok => showToast(ok ? 'Copied' : 'Failed'))}>📋 Copy</button>
				<button type="button" style={styles.btn} onClick={handleDownload}>💾 Save</button>
				<button type="button" style={styles.btn} onClick={() => setInput('')}>🗑️ Clear</button>
			</div>

			<div style={styles.statusBar}>
				<span>{input.length} chars · {input ? input.split('\n').length : 0} lines</span>
				<span style={{ color: error ? '#ef4444' : '#22c55e' }}>{error ? 'Invalid JSON' : 'Valid'}</span>
			</div>
		</div>
	);
};
