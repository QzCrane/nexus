// goal: Regex tester panel UI

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { executeRegex, validatePattern, replaceMatches, buildFlagsString } from './core';
import type { RegexFlags } from './types';
import { DEFAULT_FLAGS, PRESETS } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	input: {
		flex: 1, padding: '10px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '8px',
		color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	textarea: {
		width: '100%', minHeight: '120px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	flagBtn: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	flagActive: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	flagInactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	presetBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer',
	},
	matchItem: {
		padding: '8px', background: 'var(--halo-bg-secondary)', borderRadius: '6px',
		fontSize: '11px', fontFamily: 'monospace',
	},
	matchText: { color: 'var(--halo-accent)', fontWeight: 600 },
	matchMeta: { color: 'var(--halo-text-muted)', fontSize: '10px', marginTop: '4px' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	count: { fontSize: '12px', color: 'var(--halo-text-secondary)', fontWeight: 500 },
};

export const RegexPanel: React.FC = () => {
	const { t } = useTranslation();
	const [pattern, setPattern] = useState('');
	const [testString, setTestString] = useState('');
	const [replacement, setReplacement] = useState('');
	const [flags, setFlags] = useState<RegexFlags>(DEFAULT_FLAGS);
	const [showReplace, setShowReplace] = useState(false);

	const validation = useMemo(() => validatePattern(pattern), [pattern]);
	const matches = useMemo(
		() => (validation.valid ? executeRegex(pattern, testString, flags) : []),
		[pattern, testString, flags, validation.valid]
	);
	const replaced = useMemo(
		() => (showReplace && validation.valid ? replaceMatches(pattern, testString, replacement, flags) : ''),
		[pattern, testString, replacement, flags, showReplace, validation.valid]
	);

	const toggleFlag = useCallback((key: keyof RegexFlags) => {
		setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	const loadPreset = useCallback((preset: typeof PRESETS[0]) => {
		setPattern(preset.pattern);
		setFlags({
			global: preset.flags.includes('g'),
			ignoreCase: preset.flags.includes('i'),
			multiline: preset.flags.includes('m'),
			dotAll: preset.flags.includes('s'),
			unicode: preset.flags.includes('u'),
		});
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Pattern Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>/{' '}</span>
						<input
							style={styles.input}
							value={pattern}
							onChange={(e) => setPattern(e.target.value)}
							placeholder={t('regex.patternPlaceholder') || 'Enter regex pattern...'}
						/>
						<span style={styles.label}>/{buildFlagsString(flags)}</span>
					</div>
					{!validation.valid && <div style={styles.error}>⚠️ {validation.error}</div>}

					{/* Flags */}
					<div style={styles.row}>
						{(['global', 'ignoreCase', 'multiline', 'dotAll', 'unicode'] as const).map((key) => (
							<button
								key={key}
								style={{ ...styles.flagBtn, ...(flags[key] ? styles.flagActive : styles.flagInactive) }}
								onClick={() => toggleFlag(key)}
								title={key}
							>
								{key[0].toUpperCase()}
							</button>
						))}
					</div>

					{/* Presets */}
					<div style={{ ...styles.row, flexWrap: 'wrap', gap: '6px' }}>
						<span style={styles.label}>Presets:</span>
						{PRESETS.map((p) => (
							<button key={p.name} style={styles.presetBtn} onClick={() => loadPreset(p)}>
								{p.name}
							</button>
						))}
					</div>
				</div>
			</Card>

			{/* Test String */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<span style={styles.label}>{t('regex.testString') || 'Test String'}</span>
					<textarea
						style={styles.textarea}
						value={testString}
						onChange={(e) => setTestString(e.target.value)}
						placeholder={t('regex.testPlaceholder') || 'Enter text to test...'}
					/>
				</div>
			</Card>

			{/* Replace (Optional) */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<input
							type="checkbox"
							checked={showReplace}
							onChange={(e) => setShowReplace(e.target.checked)}
						/>
						<span style={styles.label}>{t('regex.replaceMode') || 'Replace Mode'}</span>
					</div>
					{showReplace && (
						<>
							<input
								style={styles.input}
								value={replacement}
								onChange={(e) => setReplacement(e.target.value)}
								placeholder={t('regex.replacePlaceholder') || 'Replacement text...'}
							/>
							{replaced && (
								<div style={{ ...styles.textarea, minHeight: '60px', overflow: 'auto' }}>
									{replaced}
								</div>
							)}
						</>
					)}
				</div>
			</Card>

			{/* Matches */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('regex.matches') || 'Matches'}</span>
						<span style={styles.count}>{matches.length}</span>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflow: 'auto' }}>
						{matches.length === 0 && pattern && validation.valid && (
							<div style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>No matches</div>
						)}
						{matches.map((m, i) => (
							<div key={i} style={styles.matchItem}>
								<span style={styles.matchText}>"{m.text}"</span>
								<div style={styles.matchMeta}>
									Line {m.line}, Col {m.column} (index {m.index})
								</div>
								{m.groups && Object.keys(m.groups).length > 0 && (
									<div style={styles.matchMeta}>
										Groups: {JSON.stringify(m.groups)}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</Card>
		</div>
	);
};
