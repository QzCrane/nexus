// goal: Lorem Ipsum panel UI - placeholder text generator

import type React from 'react';
import { useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { LoremUnit } from './types';
import { generateLorem } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const UNIT_OPTIONS: { id: LoremUnit; label: string }[] = [
	{ id: 'words', label: 'Words' },
	{ id: 'sentences', label: 'Sentences' },
	{ id: 'paragraphs', label: 'Paragraphs' },
];
const loremUnitCodec: ToolStateCodec<LoremUnit> = {
	decode(value) { return UNIT_OPTIONS.some((entry) => entry.id === value) ? { kind: 'valid', value: value as LoremUnit } : { kind: 'invalid', reason: 'Lorem unit is unsupported.' }; },
	encode(value) { return value; },
};
const loremCountCodec: ToolStateCodec<number> = {
	decode(value) { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 100 ? { kind: 'valid', value: value as number } : { kind: 'invalid', reason: 'Lorem count must be an integer from 1 to 100.' }; },
	encode(value) { return value; },
};

export const LoremIpsumPanel: React.FC = () => {
	const { t } = useTranslation();
	const [count, setCount, , countRecovery] = useToolState<number>('lorem-ipsum-count', 5, { codec: loremCountCodec });
	const [unit, setUnit, , unitRecovery] = useToolState<LoremUnit>('lorem-ipsum-unit', 'paragraphs', { codec: loremUnitCodec });
	const [startWithLorem, setStartWithLorem] = useToolState<boolean>('lorem-ipsum-start', true);
	const [output, setOutput] = useToolState<string>('lorem-ipsum', '');


	// Generate
	const handleGenerate = useCallback(() => {
		const result = generateLorem({ unit, count, startWithLorem });
		setOutput(result);
	}, [unit, count, startWithLorem, setOutput]);

	// Copy to clipboard
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={countRecovery} emptyValue={5} exportName="halo-lorem-count-damaged.json" />
			<StorageRecoveryActions recovery={unitRecovery} emptyValue="paragraphs" exportName="halo-lorem-unit-damaged.json" />
			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={styles.label}>{t('loremIpsum.generate')}</span>
					<input
						type="number"
						style={styles.input}
						value={count}
						onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
						min={1}
						max={100}
					/>
					<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
						{UNIT_OPTIONS.map((opt) => (
							<button
								key={opt.id}
								type="button"
								style={{
									border: 'none',
									background: unit === opt.id ? 'var(--halo-accent)' : 'transparent',
									color: unit === opt.id ? '#fff' : 'var(--halo-text-muted)',
									padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
								}}
								onClick={() => setUnit(opt.id)}
							>
								{t(`loremIpsum.units.${opt.id}`)}
							</button>
						))}
					</div>
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
				<button type="button" style={styles.btn} onClick={handleGenerate}>🎲 {t('loremIpsum.generateBtn')}</button>
				{output && <button type="button" style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>

			{/* Output */}
			{output && (
				<textarea style={styles.output} value={output} readOnly />
			)}
		</div>
	);
};
