// goal: Unit Converter panel UI - length/weight/temp/time/data conversion

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { UnitCategory } from './types';
import { UNITS, convertUnit, formatResult } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const CATEGORIES: UnitCategory[] = ['length', 'weight', 'temperature', 'time', 'data'];

export const UnitConverterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [category, setCategory] = useToolState<UnitCategory>('unit-category' as any, 'length');
	const [inputValue, setInputValue] = useToolState<string>('unit-input' as any, '1');
	const [fromUnit, setFromUnit] = useToolState<string>('unit-from' as any, 'm');
	const [toUnit, setToUnit] = useToolState<string>('unit-to' as any, 'km');


	const units = useMemo(() => UNITS[category], [category]);

	// Get unit objects
	const fromUnitObj = useMemo(() => units.find((u) => u.id === fromUnit) || units[0], [units, fromUnit]);
	const toUnitObj = useMemo(() => units.find((u) => u.id === toUnit) || units[1], [units, toUnit]);

	// Calculate result
	const result = useMemo(() => {
		const value = parseFloat(inputValue);
		if (isNaN(value)) return '';
		return formatResult(convertUnit(value, fromUnitObj, toUnitObj));
	}, [inputValue, fromUnitObj, toUnitObj]);

	// Handle category change
	const handleCategoryChange = useCallback((cat: UnitCategory) => {
		setCategory(cat);
		const catUnits = UNITS[cat];
		setFromUnit(catUnits[0]?.id || '');
		setToUnit(catUnits[1]?.id || catUnits[0]?.id || '');
	}, []);

	// Swap units
	const handleSwap = useCallback(() => {
		setFromUnit(toUnit);
		setToUnit(fromUnit);
	}, [fromUnit, toUnit]);

	return (
		<div style={styles.wrapper}>
			{/* Category Tabs */}
			<div style={styles.tabs}>
				{CATEGORIES.map((cat) => (
					<button
						key={cat}
						style={{ ...styles.tab, ...(category === cat ? styles.active : styles.inactive) }}
						onClick={() => handleCategoryChange(cat)}
					>
						{t(`unitConverter.categories.${cat}`, { defaultValue: cat })}
					</button>
				))}
			</div>

			{/* Input Section */}
			<Card variant="default" padding="sm">
				<div style={styles.inputSection}>
					<div style={styles.inputGroup}>
						<span style={styles.label}>{t('unitConverter.from')}</span>
						<input
							type="number"
							style={styles.input}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							placeholder="0"
						/>
						<select style={styles.select} value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
							{units.map((u) => (
								<option key={u.id} value={u.id}>{t(`unitConverter.units.${u.id}`, { defaultValue: u.name })} ({u.symbol})</option>
							))}
						</select>
					</div>
					<button style={styles.swapBtn} onClick={handleSwap} title={t('unitConverter.swap')}>⇄</button>
					<div style={styles.inputGroup}>
						<span style={styles.label}>{t('unitConverter.to')}</span>
						<div style={{ ...styles.input, background: 'var(--halo-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
							{result || '—'}
						</div>
						<select style={styles.select} value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
							{units.map((u) => (
								<option key={u.id} value={u.id}>{t(`unitConverter.units.${u.id}`, { defaultValue: u.name })} ({u.symbol})</option>
							))}
						</select>
					</div>
				</div>
			</Card>

			{/* Result Display */}
			{result && (
				<div style={styles.result}>
					<div style={styles.resultValue}>{inputValue} {fromUnitObj.symbol} = {result} {toUnitObj.symbol}</div>
					<div style={styles.resultUnit}>{t(`unitConverter.units.${fromUnitObj.id}`, { defaultValue: fromUnitObj.name })} → {t(`unitConverter.units.${toUnitObj.id}`, { defaultValue: toUnitObj.name })}</div>
				</div>
			)}
		</div>
	);
};
