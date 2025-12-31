// goal: Text Tools panel UI - case conversion, stats, dedupe, sort

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { CaseType, TextToolMode } from './types';
import { convertCase, getTextStats, dedupeLines, sortLines, trimLines, reverseLines } from './core';
import { styles } from './panel.styles';

const MODES: { id: TextToolMode; label: string }[] = [
	{ id: 'case', label: 'Case' },
	{ id: 'stats', label: 'Stats' },
	{ id: 'dedupe', label: 'Dedupe' },
	{ id: 'sort', label: 'Sort' },
];

const CASE_OPTIONS: { id: CaseType; label: string }[] = [
	{ id: 'lower', label: 'lowercase' },
	{ id: 'upper', label: 'UPPERCASE' },
	{ id: 'title', label: 'Title Case' },
	{ id: 'sentence', label: 'Sentence case' },
	{ id: 'camel', label: 'camelCase' },
	{ id: 'snake', label: 'snake_case' },
	{ id: 'constant', label: 'CONSTANT_CASE' },
	{ id: 'kebab', label: 'kebab-case' },
];

export const TextToolsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<TextToolMode>('case');
	const [input, setInput] = useState('');
	const [caseType, setCaseType] = useState<CaseType>('lower');

	// Compute stats in real-time
	const stats = useMemo(() => getTextStats(input), [input]);

	// Handle case conversion
	const handleCaseConvert = useCallback(() => {
		setInput(convertCase(input, caseType));
	}, [input, caseType]);

	// Handle dedupe
	const handleDedupe = useCallback(() => setInput(dedupeLines(input)), [input]);

	// Handle sort
	const handleSort = useCallback((asc: boolean) => setInput(sortLines(input, asc)), [input]);

	// Handle trim
	const handleTrim = useCallback(() => setInput(trimLines(input)), [input]);

	// Handle reverse
	const handleReverse = useCallback(() => setInput(reverseLines(input)), [input]);

	// Copy to clipboard
	const handleCopy = useCallback(() => navigator.clipboard.writeText(input), [input]);

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<Card variant="default" padding="sm">
				<div style={styles.tabs}>
					{MODES.map((m) => (
						<button
							key={m.id}
							style={{ ...styles.tab, ...(mode === m.id ? styles.active : styles.inactive) }}
							onClick={() => setMode(m.id)}
						>
							{t(`textTools.modes.${m.id}`)}
						</button>
					))}
				</div>
			</Card>

			{/* Input */}
			<textarea
				style={styles.textarea}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder={t('textTools.placeholder')}
			/>

			{/* Mode-specific UI */}
			{mode === 'case' && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<select style={styles.select} value={caseType} onChange={(e) => setCaseType(e.target.value as CaseType)}>
							{CASE_OPTIONS.map((opt) => (
								<option key={opt.id} value={opt.id}>{opt.label}</option>
							))}
						</select>
						<button style={styles.btn} onClick={handleCaseConvert}>{t('textTools.convert')}</button>
						<button style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>
					</div>
				</Card>
			)}

			{mode === 'stats' && (
				<Card variant="default" padding="sm">
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
						<div style={styles.stat}><span style={styles.statLabel}>{t('textTools.stats.chars')}</span><span style={styles.statValue}>{stats.chars}</span></div>
						<div style={styles.stat}><span style={styles.statLabel}>{t('textTools.stats.charsNoSpaces')}</span><span style={styles.statValue}>{stats.charsNoSpaces}</span></div>
						<div style={styles.stat}><span style={styles.statLabel}>{t('textTools.stats.words')}</span><span style={styles.statValue}>{stats.words}</span></div>
						<div style={styles.stat}><span style={styles.statLabel}>{t('textTools.stats.lines')}</span><span style={styles.statValue}>{stats.lines}</span></div>
						<div style={styles.stat}><span style={styles.statLabel}>{t('textTools.stats.bytes')}</span><span style={styles.statValue}>{stats.bytes}</span></div>
					</div>
				</Card>
			)}

			{mode === 'dedupe' && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<button style={styles.btn} onClick={handleDedupe}>{t('textTools.dedupe')}</button>
						<button style={styles.btnSecondary} onClick={handleTrim}>{t('textTools.trim')}</button>
						<button style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>
					</div>
				</Card>
			)}

			{mode === 'sort' && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<button style={styles.btn} onClick={() => handleSort(true)}>↑ {t('textTools.sortAsc')}</button>
						<button style={styles.btn} onClick={() => handleSort(false)}>↓ {t('textTools.sortDesc')}</button>
						<button style={styles.btnSecondary} onClick={handleReverse}>{t('textTools.reverse')}</button>
						<button style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>
					</div>
				</Card>
			)}
		</div>
	);
};
