// goal: Number Base panel UI - base conversion (2/8/10/16)

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { Base, BaseConvertResult } from './types';
import { convertBase, isValidForBase, formatWithGrouping, BASE_LABELS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const BASES: Base[] = [2, 8, 10, 16];

export const NumberBasePanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('number-base', '');
	const [fromBase, setFromBase] = useToolState<Base>('number-base-from' as any, 10);


	// Compute result in real-time
	const result = useMemo<BaseConvertResult | null>(() => {
		if (!input || !isValidForBase(input, fromBase)) return null;
		return convertBase(input, fromBase);
	}, [input, fromBase]);

	// Copy to clipboard
	const handleCopy = useCallback((value: string) => {
		navigator.clipboard.writeText(value);
	}, []);

	const isValid = !input || isValidForBase(input, fromBase);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={styles.label}>{t('numberBase.input')}</span>
					<input
						style={{ ...styles.input, borderColor: isValid ? 'var(--halo-border)' : 'var(--halo-error, #ef4444)' }}
						value={input}
						onChange={(e) => setInput(e.target.value.trim())}
						placeholder={t('numberBase.placeholder')}
					/>
					<select style={styles.select} value={fromBase} onChange={(e) => setFromBase(Number(e.target.value) as Base)}>
						{BASES.map((b) => (
							<option key={b} value={b}>{BASE_LABELS[b]}</option>
						))}
					</select>
				</div>
			</Card>

			{/* Validation Error */}
			{input && !isValid && (
				<div style={styles.error}>⚠️ {t('numberBase.invalidInput')}</div>
			)}

			{/* Results */}
			{result && (
				<>
					<div style={styles.resultCard}>
						<div>
							<div style={styles.resultLabel}>Binary (2)</div>
							<div style={styles.resultValue}>{formatWithGrouping(result.binary, 4)}</div>
						</div>
						<button style={styles.btnCopy} onClick={() => handleCopy(result.binary)}>📋</button>
					</div>
					<div style={styles.resultCard}>
						<div>
							<div style={styles.resultLabel}>Octal (8)</div>
							<div style={styles.resultValue}>{result.octal}</div>
						</div>
						<button style={styles.btnCopy} onClick={() => handleCopy(result.octal)}>📋</button>
					</div>
					<div style={styles.resultCard}>
						<div>
							<div style={styles.resultLabel}>Decimal (10)</div>
							<div style={styles.resultValue}>{Number(result.decimal).toLocaleString()}</div>
						</div>
						<button style={styles.btnCopy} onClick={() => handleCopy(result.decimal)}>📋</button>
					</div>
					<div style={styles.resultCard}>
						<div>
							<div style={styles.resultLabel}>Hexadecimal (16)</div>
							<div style={styles.resultValue}>0x{result.hex}</div>
						</div>
						<button style={styles.btnCopy} onClick={() => handleCopy(result.hex)}>📋</button>
					</div>
				</>
			)}
		</div>
	);
};
