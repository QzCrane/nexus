// goal: Regex tester panel UI
// eff: Styles extracted to reduce file size

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { executeRegex, validatePattern, replaceMatches, buildFlagsString } from './core';
import type { RegexFlags } from './types';
import { DEFAULT_FLAGS, PRESETS } from './types';
import { styles } from './panel.styles';

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
							<div style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>{t('regex.noMatches')}</div>
						)}
						{matches.map((m, i) => (
							<div key={i} style={styles.matchItem}>
								<span style={styles.matchText}>"{m.text}"</span>
								<div style={styles.matchMeta}>
									{t('regex.matchInfo').replace('{{line}}', String(m.line)).replace('{{col}}', String(m.column)).replace('{{index}}', String(m.index))}
								</div>
								{m.groups && Object.keys(m.groups).length > 0 && (
									<div style={styles.matchMeta}>
										{t('regex.groups')}: {JSON.stringify(m.groups)}
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
