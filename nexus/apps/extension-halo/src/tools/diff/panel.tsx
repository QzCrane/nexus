// goal: Diff panel UI - text comparison with highlighted differences

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { DiffResult, DiffStats } from './types';
import { diffLines, getDiffStats } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const DiffPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, setState] = useToolState('diff', { text1: '', text2: '' });
	const { text1, text2 } = state;

	const [diffs, setDiffs] = useState<DiffResult[] | null>(null);
	const [stats, setStats] = useState<DiffStats | null>(null);

	const setText1 = (val: string) => setState({ ...state, text1: val });
	const setText2 = (val: string) => setState({ ...state, text2: val });

	// Compare
	const handleCompare = useCallback(() => {
		const result = diffLines(text1, text2);
		setDiffs(result);
		setStats(getDiffStats(result));
	}, [text1, text2]);

	// Swap
	const handleSwap = useCallback(() => {
		setState({ text1: text2, text2: text1 });
		setDiffs(null);
		setStats(null);
	}, [text1, text2, setState]);

	// Clear
	const handleClear = useCallback(() => {
		setState({ text1: '', text2: '' });
		setDiffs(null);
		setStats(null);
	}, [setState]);


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
				<button type="button" style={styles.btn} onClick={handleCompare}>{t('diff.compare')}</button>
				<button type="button" style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleSwap}>⇄ {t('diff.swap')}</button>
				<button type="button" style={{ ...styles.btn, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' }} onClick={handleClear}>{t('diff.clear')}</button>
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
								// biome-ignore lint/suspicious/noArrayIndexKey: Diff segments are a stateless ordered projection; sequence position is their identity.
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
