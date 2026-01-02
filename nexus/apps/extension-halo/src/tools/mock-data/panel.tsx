// goal: Mock data generator panel UI

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { MockField, MockDataType, MockConfig } from './types';
import { generateMockData } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const DATA_TYPES: MockDataType[] = ['name', 'email', 'phone', 'uuid', 'address', 'lorem', 'number', 'date'];
const FORMATS = ['json', 'csv', 'sql'] as const;

export const MockDataPanel: React.FC = () => {
	const { t } = useTranslation();
	const [fields, setFields] = useToolState<MockField[]>('mock-data-fields' as any, [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'name' }, { name: 'email', type: 'email' }]);
	const [count, setCount] = useToolState<number>('mock-data-count' as any, 10);
	const [format, setFormat] = useToolState<'json' | 'csv' | 'sql'>('mock-data-format' as any, 'json');
	const [output, setOutput] = useToolState<string>('mock-data-output' as any, '');


	const addField = useCallback(() => {
		setFields((prev) => [...prev, { name: `field${prev.length + 1}`, type: 'name' }]);
	}, []);

	const removeField = useCallback((index: number) => {
		setFields((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const updateField = useCallback((index: number, key: keyof MockField, value: string) => {
		setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
	}, []);

	const generate = useCallback(() => {
		const config: MockConfig = { fields, count, format };
		setOutput(generateMockData(config));
	}, [fields, count, format]);

	const copyOutput = () => navigator.clipboard.writeText(output);

	return (
		<div style={styles.wrapper}>
			{/* Fields Configuration */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
					<span style={styles.label}>{t('mockData.fields')}</span>
					<button style={styles.btnSecondary} onClick={addField}>+ {t('mockData.addField')}</button>
				</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
					{fields.map((field, i) => (
						<div key={i} style={styles.fieldRow}>
							<input style={styles.input} value={field.name} onChange={(e) => updateField(i, 'name', e.target.value)} placeholder={t('mockData.fieldName')} />
							<select style={styles.select} value={field.type} onChange={(e) => updateField(i, 'type', e.target.value as MockDataType)}>
								{DATA_TYPES.map((type) => (<option key={type} value={type}>{type}</option>))}
							</select>
							<button style={styles.btnDanger} onClick={() => removeField(i)}>✕</button>
						</div>
					))}
				</div>
			</Card>

			{/* Generation Options */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={styles.label}>{t('mockData.count')}</span>
					<input type="number" style={styles.inputSmall} value={count} onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={1000} />
					<span style={styles.label}>{t('mockData.format')}</span>
					<select style={styles.select} value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv' | 'sql')}>
						{FORMATS.map((f) => (<option key={f} value={f}>{f.toUpperCase()}</option>))}
					</select>
					<button style={styles.btn} onClick={generate}>{t('mockData.generate')}</button>
				</div>
			</Card>

			{/* Output */}
			{output && (
				<Card variant="default" padding="sm">
					<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
						<span style={styles.label}>{t('mockData.output')}</span>
						<button style={styles.btnSecondary} onClick={copyOutput}>📋 {t('common.copy')}</button>
					</div>
					<textarea style={styles.textarea} value={output} readOnly />
				</Card>
			)}
		</div>
	);
};
