// goal: Unit Converter panel UI - length/weight/temp/time/data conversion

import type React from 'react';
import { useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { UnitCategory } from './types';
import { UNITS, convertUnit, formatResult } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const CATEGORIES: UnitCategory[] = ['length', 'weight', 'temperature', 'time', 'data'];
const unitCategoryCodec: ToolStateCodec<UnitCategory> = {
	decode(value) { return CATEGORIES.includes(value as UnitCategory) ? { kind: 'valid', value: value as UnitCategory } : { kind: 'invalid', reason: 'Unit category is unsupported.' }; },
	encode(value) { return value; },
};
const unitIdCodec: ToolStateCodec<string> = {
	decode(value) { return typeof value === 'string' && Object.values(UNITS).some((units) => units.some((unit) => unit.id === value)) ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Unit identifier is unsupported.' }; },
	encode(value) { return value; },
};

export const UnitConverterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [category, setCategory, , categoryRecovery] = useToolState<UnitCategory>('unit-category', 'length', { codec: unitCategoryCodec });
	const [inputValue, setInputValue] = useToolState<string>('unit-input', '1');
	const [fromUnit, setFromUnit, , fromRecovery] = useToolState<string>('unit-from', 'm', { codec: unitIdCodec });
	const [toUnit, setToUnit, , toRecovery] = useToolState<string>('unit-to', 'km', { codec: unitIdCodec });


	const units = useMemo(() => UNITS[category], [category]);

	// Get unit objects
	const fromUnitObj = useMemo(() => units.find((u) => u.id === fromUnit) ?? units[0], [units, fromUnit]);
	const toUnitObj = useMemo(() => units.find((u) => u.id === toUnit) ?? units[1], [units, toUnit]);

	// Calculate result
	const result = useMemo(() => {
		const value = parseFloat(inputValue);
		if (Number.isNaN(value)) return '';
		return formatResult(convertUnit(value, fromUnitObj, toUnitObj));
	}, [inputValue, fromUnitObj, toUnitObj]);

	// Handle category change
	const handleCategoryChange = useCallback((cat: UnitCategory) => {
		setCategory(cat);
		const catUnits = UNITS[cat];
		setFromUnit(catUnits[0].id);
		setToUnit(catUnits[1].id);
	}, [setFromUnit, setCategory, setToUnit]);

	// Swap units
	const handleSwap = useCallback(() => {
		setFromUnit(toUnit);
		setToUnit(fromUnit);
	}, [fromUnit, toUnit, setToUnit, setFromUnit]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={categoryRecovery} emptyValue="length" exportName="halo-unit-category-damaged.json" />
			<StorageRecoveryActions recovery={fromRecovery} emptyValue="m" exportName="halo-unit-from-damaged.json" />
			<StorageRecoveryActions recovery={toRecovery} emptyValue="km" exportName="halo-unit-to-damaged.json" />
			{/* Category Tabs */}
			<div style={styles.tabs}>
				{CATEGORIES.map((cat) => (
					<button type="button"
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
					<button type="button" style={styles.swapBtn} onClick={handleSwap} title={t('unitConverter.swap')}>⇄</button>
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
