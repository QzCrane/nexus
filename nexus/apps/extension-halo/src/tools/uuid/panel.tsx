// goal: UUID generator panel UI

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateV4, generateV7, generateULID, formatUUID } from './core';
import { UUID_VERSIONS, type UUIDVersion } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	textarea: {
		width: '100%', minHeight: '150px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	optionBtn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	input: {
		width: '60px', padding: '6px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '6px',
		color: 'var(--halo-text)', fontSize: '12px', textAlign: 'center' as const,
	},
	generateBtn: {
		flex: 1, padding: '10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', background: 'var(--halo-accent)', borderRadius: '24px', fontSize: '12px', fontWeight: 500, color: '#fff', zIndex: 1000 },
};

export const UUIDPanel: React.FC = () => {
	const { t } = useTranslation();
	const [version, setVersion] = useState<UUIDVersion>('v4');
	const [count, setCount] = useState(1);
	const [uppercase, setUppercase] = useState(false);
	const [hyphens, setHyphens] = useState(true);
	const [result, setResult] = useState('');
	const [toast, setToast] = useState<string | null>(null);

	const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1500); }, []);

	const handleGenerate = useCallback(() => {
		const generated: string[] = [];
		for (let i = 0; i < count; i++) {
			let raw = '';
			switch (version) {
				case 'v4': raw = generateV4(); break;
				case 'v7': raw = generateV7(); break;
				case 'ULID': raw = generateULID(); break;
			}
			// ULID default is no hyphens, force hyphens option doesn't apply cleanly to ULID unless manually added (not standard), 
			// but we can apply uppercase/lowercase. ULID is usually uppercase.
			const formatted = formatUUID(raw, uppercase, version === 'ULID' ? false : hyphens);
			generated.push(formatted);
		}
		setResult(generated.join('\n'));
	}, [version, count, uppercase, hyphens]);

	return (
		<div style={styles.wrapper}>
			{/* Options */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('uuid.type')}</span>
						{UUID_VERSIONS.map(v => (
							<button
								key={v}
								style={{ ...styles.optionBtn, ...(version === v ? styles.active : styles.inactive) }}
								onClick={() => setVersion(v)}
							>
								{v}
							</button>
						))}
					</div>
					
					<div style={styles.row}>
						<span style={styles.label}>{t('uuid.count')}:</span>
						<input
							type="number"
							min="1"
							max="100"
							style={styles.input}
							value={count}
							onChange={(e) => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
						/>
					</div>

					<div style={styles.row}>
						<label style={styles.checkbox}>
							<input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
							<span>{t('uuid.uppercase')}</span>
						</label>
						{version !== 'ULID' && (
							<label style={styles.checkbox}>
								<input type="checkbox" checked={hyphens} onChange={(e) => setHyphens(e.target.checked)} />
								<span>{t('uuid.hyphens')}</span>
							</label>
						)}
					</div>

					<button style={styles.generateBtn} onClick={handleGenerate}>
						⚡ {t('uuid.generate')}
					</button>
				</div>
			</Card>

			{/* Result */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('common.result') || 'Result'}</span>
						<button
							style={{ ...styles.optionBtn, marginLeft: 'auto' }}
							onClick={() => { if (result) { navigator.clipboard.writeText(result); showToast(t('common.copied') || 'Copied!'); } }}
							disabled={!result}
						>
							📋 {t('common.copy')}
						</button>
					</div>
					<textarea
						style={styles.textarea}
						value={result}
						readOnly
						placeholder={t('uuid.placeholder')}
					/>
				</div>
			</Card>
			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
