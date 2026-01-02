// goal: Lorem Ipsum panel UI - placeholder text generator

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { LoremUnit } from './types';
import { generateLorem } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const UNIT_OPTIONS: { id: LoremUnit; label: string }[] = [
	{ id: 'words', label: 'Words' },
	{ id: 'sentences', label: 'Sentences' },
	{ id: 'paragraphs', label: 'Paragraphs' },
];

export const LoremIpsumPanel: React.FC = () => {
	const { t } = useTranslation();
	const [count, setCount] = useToolState<number>('lorem-ipsum-count' as any, 5);
	const [unit, setUnit] = useToolState<LoremUnit>('lorem-ipsum-unit' as any, 'paragraphs');
	const [startWithLorem, setStartWithLorem] = useToolState<boolean>('lorem-ipsum-start' as any, true);
	const [output, setOutput] = useToolState<string>('lorem-ipsum', '');


	// Generate
	const handleGenerate = useCallback(() => {
		const result = generateLorem({ unit, count, startWithLorem });
		setOutput(result);
	}, [unit, count, startWithLorem]);

	// Copy to clipboard
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={styles.label}>{t('loremIpsum.generate')}</span>
					<input
						type="number"
						style={styles.input}
						value={count}
						onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
						min={1}
						max={100}
					/>
					<select style={styles.select} value={unit} onChange={(e) => setUnit(e.target.value as LoremUnit)}>
						{UNIT_OPTIONS.map((opt) => (
							<option key={opt.id} value={opt.id}>{t(`loremIpsum.units.${opt.id}`)}</option>
						))}
					</select>
				</div>
				<label style={{ ...styles.checkbox, marginTop: '10px' }}>
					<input
						type="checkbox"
						checked={startWithLorem}
						onChange={(e) => setStartWithLorem(e.target.checked)}
					/>
					{t('loremIpsum.startWithLorem')}
				</label>
			</Card>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleGenerate}>🎲 {t('loremIpsum.generateBtn')}</button>
				{output && <button style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>

			{/* Output */}
			{output && (
				<textarea style={styles.output} value={output} readOnly />
			)}
		</div>
	);
};
