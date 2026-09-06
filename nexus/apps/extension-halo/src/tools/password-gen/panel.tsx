// goal: Password Generator panel UI with Bulk Generation and Strength analysis

import type React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PasswordConfig } from './types';
import { generatePassword, generatePasswords, evaluateStrength, DEFAULT_CONFIG } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


import { useToast } from '../../components/ToastProvider';

interface GeneratedPassword {
	id: string;
	value: string;
}

export const PasswordGenPanel: React.FC = () => {
	const { t } = useTranslation();
    const { showToast } = useToast();
	const [config, setConfig] = useToolState<PasswordConfig>('password-gen-opts', DEFAULT_CONFIG);

	const [password, setPassword] = useState(() => generatePassword(DEFAULT_CONFIG));
	const [bulkPasswords, setBulkPasswords] = useState<GeneratedPassword[]>([]);
	const [showBulk, setShowBulk] = useState(false);
	const [error, setError] = useState('');
	// const [toast, setToast] = useState<string | null>(null); // Removed

	const strength = useMemo(() => evaluateStrength(password), [password]);

	// const showToast = ... // Removed local implementation

	const handleGenerate = useCallback(() => {
		try {
			if (showBulk) {
				setBulkPasswords(generatePasswords(config, 10).map((value) => ({ id: crypto.randomUUID(), value })));
			} else setPassword(generatePassword(config));
			setError('');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Password generation failed');
		}
	}, [config, showBulk]);

	const handleCopy = useCallback(async (pwd: string) => {
		try {
			await navigator.clipboard.writeText(pwd);
			showToast(t('passwordGen.copied', { defaultValue: 'Copied!' }));
		} catch (error: unknown) {
			console.error('[HALO:PasswordGen] Failed to copy password', error);
			showToast(t('passwordGen.copyFailed', { defaultValue: 'Copy failed' }));
		}
	}, [showToast, t]);

	const updateConfig = useCallback((key: keyof PasswordConfig, value: unknown) => {
		setConfig((c) => ({ ...c, [key]: value }));
	}, [setConfig]);

	// Auto-regenerate on config change
	useEffect(() => {
		handleGenerate();
	}, [handleGenerate]);

	return (
		<div style={styles.wrapper}>
			{error && <div role="alert">{error}</div>}
			{/* Mode Toggle */}
			<div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
				<button type="button"
					style={{ ...styles.btn, flex: 1, ...(showBulk ? styles.btnSecondary : {}) }}
					onClick={() => setShowBulk(false)}
				>
					{t('passwordGen.single', { defaultValue: 'Single' })}
				</button>
				<button type="button"
					style={{ ...styles.btn, flex: 1, ...(!showBulk ? styles.btnSecondary : {}) }}
					onClick={() => setShowBulk(true)}
				>
					{t('passwordGen.bulk', { defaultValue: 'Bulk (10)' })}
				</button>
			</div>

			{!showBulk ? (
				<>
					<div style={styles.password}>{password}</div>
					<div style={{ ...styles.strength, background: `${strength.color}20`, color: strength.color }}>
						🔐 {strength.label} — {strength.feedback.join(' ')}
					</div>
					<div style={styles.row}>
						<button type="button" style={{ ...styles.btn, flex: 2 }} onClick={handleGenerate}>🎲 {t('passwordGen.regenerate', { defaultValue: 'Regenerate' })}</button>
						<button type="button" style={{ ...styles.btnSecondary, flex: 1 }} onClick={() => handleCopy(password)}>📋 {t('passwordGen.copy', { defaultValue: 'Copy' })}</button>
					</div>
				</>
			) : (
				<Card variant="default" padding="sm">
					<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
						{bulkPasswords.map(({ id, value }) => (
							<div key={id} style={{ ...styles.listItem, padding: '6px 8px' }}>
								<span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{value}</span>
								<button type="button" style={{ ...styles.btnSecondary, padding: '2px 8px' }} onClick={() => handleCopy(value)}>📋</button>
							</div>
						))}
					</div>
					<button type="button" style={{ ...styles.btn, width: '100%', marginTop: '8px' }} onClick={handleGenerate}>🔄 {t('passwordGen.refreshAll', { defaultValue: 'Refresh All' })}</button>
				</Card>
			)}

			<Card variant="default" padding="sm">
				<div style={styles.slider}>
					<span style={styles.label}>Length</span>
					<input type="range" min={6} max={128} value={config.length} onChange={(e) => updateConfig('length', +e.target.value)} style={{ flex: 1 }} />
					<span style={{ ...styles.label, width: '30px', textAlign: 'right' }}>{config.length}</span>
				</div>
				<div style={{ ...styles.config, marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.uppercase} onChange={(e) => updateConfig('uppercase', e.target.checked)} />
						Uppercase
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.lowercase} onChange={(e) => updateConfig('lowercase', e.target.checked)} />
						Lowercase
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.numbers} onChange={(e) => updateConfig('numbers', e.target.checked)} />
						Numbers
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.symbols} onChange={(e) => updateConfig('symbols', e.target.checked)} />
						Symbols
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.excludeAmbiguous} onChange={(e) => updateConfig('excludeAmbiguous', e.target.checked)} />
						{t('passwordGen.excludeAmbiguous', { defaultValue: 'No (0O1lI)' })}
					</label>
				</div>
			</Card>

{/* Toast removed */}
		</div>
	);
};
