// goal: HTML Entity panel UI - encode and decode HTML entities

import type React from 'react';
import { useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { EntityMode } from './types';
import { encodeHtmlSpecial, encodeHtmlNamed, encodeHtmlAll, decodeHtml, getEntityTable } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

const entityModeCodec: ToolStateCodec<EntityMode> = {
	decode(value) { return value === 'encode' || value === 'decode' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'HTML entity mode is unsupported.' }; },
	encode(value) { return value; },
};

export const HtmlEntityPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode, , modeRecovery] = useToolState<EntityMode>('html-entity-mode', 'encode', { codec: entityModeCodec });
	const [input, setInput] = useToolState<string>('html-entity-input', '');
	const [output, setOutput] = useToolState<string>('html-entity-output', '');
	const [showTable, setShowTable] = useToolState<boolean>('html-entity-table', false);


	const entityTable = useMemo(() => getEntityTable(), []);

	// Encode special characters only
	const handleEncodeSpecial = useCallback(() => {
		setOutput(encodeHtmlSpecial(input));
	}, [input, setOutput]);

	// Encode to named entities
	const handleEncodeNamed = useCallback(() => {
		setOutput(encodeHtmlNamed(input));
	}, [input, setOutput]);

	// Encode all to numeric
	const handleEncodeAll = useCallback(() => {
		setOutput(encodeHtmlAll(input));
	}, [input, setOutput]);

	// Decode
	const handleDecode = useCallback(() => {
		setOutput(decodeHtml(input));
	}, [input, setOutput]);

	// Copy output
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="encode" exportName="halo-html-entity-mode-damaged.json" />
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button type="button"
					style={{ ...styles.tab, ...(mode === 'encode' ? styles.active : styles.inactive) }}
					onClick={() => setMode('encode')}
				>
					{t('htmlEntity.encode')}
				</button>
				<button type="button"
					style={{ ...styles.tab, ...(mode === 'decode' ? styles.active : styles.inactive) }}
					onClick={() => setMode('decode')}
				>
					{t('htmlEntity.decode')}
				</button>
			</div>

			{/* Input */}
			<div>
				<span style={styles.label}>{t('htmlEntity.input')}</span>
				<textarea
					style={styles.textarea}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={mode === 'encode' ? '<div>Hello & World</div>' : '&lt;div&gt;Hello &amp; World&lt;/div&gt;'}
				/>
			</div>

			{/* Actions */}
			<div style={styles.row}>
				{mode === 'encode' ? (
					<>
						<button type="button" style={styles.btn} onClick={handleEncodeSpecial}>{t('htmlEntity.encodeSpecial')}</button>
						<button type="button" style={styles.btnSecondary} onClick={handleEncodeNamed}>{t('htmlEntity.encodeNamed')}</button>
						<button type="button" style={styles.btnSecondary} onClick={handleEncodeAll}>{t('htmlEntity.encodeAll')}</button>
					</>
				) : (
					<button type="button" style={styles.btn} onClick={handleDecode}>{t('htmlEntity.decodeBtn')}</button>
				)}
				{output && <button type="button" style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>

			{/* Output */}
			{output && (
				<div>
					<span style={styles.label}>{t('htmlEntity.output')}</span>
					<textarea style={styles.textarea} value={output} readOnly />
				</div>
			)}

			{/* Entity Reference Table */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={styles.label}>{t('htmlEntity.reference')}</span>
					<button type="button" style={styles.btnSecondary} onClick={() => setShowTable(!showTable)}>
						{showTable ? '▲' : '▼'}
					</button>
				</div>
				{showTable && (
					<div style={{ ...styles.table, marginTop: '8px' }}>
						{entityTable.slice(0, 24).map((item) => (
							<div key={item.entity} style={styles.tableItem}>
								<div style={{ fontSize: '16px' }}>{item.char}</div>
								<div style={{ color: 'var(--halo-text-muted)' }}>{item.entity}</div>
							</div>
						))}
					</div>
				)}
			</Card>
		</div>
	);
};
