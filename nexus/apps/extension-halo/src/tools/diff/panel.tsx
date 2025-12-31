// goal: Diff panel UI - text comparison with highlighted differences

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { DiffResult, DiffStats } from './types';
import { diffLines, getDiffStats } from './core';
import { styles } from './panel.styles';

export const DiffPanel: React.FC = () => {
	const { t } = useTranslation();
	const [text1, setText1] = useState('');
	const [text2, setText2] = useState('');
	const [diffs, setDiffs] = useState<DiffResult[] | null>(null);
	const [stats, setStats] = useState<DiffStats | null>(null);

	// Compare
	const handleCompare = useCallback(() => {
		const result = diffLines(text1, text2);
		setDiffs(result);
		setStats(getDiffStats(result));
	}, [text1, text2]);

	// Swap
	const handleSwap = useCallback(() => {
		setText1(text2);
		setText2(text1);
		setDiffs(null);
		setStats(null);
	}, [text1, text2]);

	// Clear
	const handleClear = useCallback(() => {
		setText1('');
		setText2('');
		setDiffs(null);
		setStats(null);
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<div style={styles.inputRow}>
				<div>
					<span style={styles.label}>{t('diff.original')}</span>
					<textarea style={styles.textarea} value={text1} onChange={(e) => setText1(e.target.value)} placeholder={t('diff.pasteOriginal')} />
				</div>
				<div>
					<span style={styles.label}>{t('diff.modified')}</span>
					<textarea style={styles.textarea} value={text2} onChange={(e) => setText2(e.target.value)} placeholder={t('diff.pasteModified')} />
				</div>
			</div>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleCompare}>{t('diff.compare')}</button>
				<button style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleSwap}>⇄ {t('diff.swap')}</button>
				<button style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleClear}>{t('diff.clear')}</button>
			</div>

			{/* Stats */}
			{stats && (
				<div style={styles.stats}>
					<span style={styles.statAdd}>+{stats.additions} {t('diff.additions')}</span>
					<span style={styles.statDel}>-{stats.deletions} {t('diff.deletions')}</span>
				</div>
			)}

			{/* Diff Output */}
			{diffs && (
				<Card variant="default" padding="sm">
					<div style={styles.diffOutput}>
						{diffs.map((diff, i) => {
							let lineStyle = styles.lineEqual;
							let prefix = '  ';
							if (diff.type === 'insert') {
								lineStyle = styles.lineInsert;
								prefix = '+ ';
							} else if (diff.type === 'delete') {
								lineStyle = styles.lineDelete;
								prefix = '- ';
							}
							return (
								<div key={i} style={lineStyle}>
									{prefix}{diff.value}
								</div>
							);
						})}
					</div>
				</Card>
			)}
		</div>
	);
};
