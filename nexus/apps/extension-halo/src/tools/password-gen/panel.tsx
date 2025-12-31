// goal: Password Generator panel UI - generate and evaluate passwords

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PasswordConfig } from './types';
import { generatePassword, generatePasswords, evaluateStrength, DEFAULT_CONFIG } from './core';
import { styles } from './panel.styles';

export const PasswordGenPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useState<PasswordConfig>(DEFAULT_CONFIG);
	const [password, setPassword] = useState(() => generatePassword(DEFAULT_CONFIG));
	const [history, setHistory] = useState<string[]>([]);

	const strength = useMemo(() => evaluateStrength(password), [password]);

	// Generate new password
	const handleGenerate = useCallback(() => {
		const newPwd = generatePassword(config);
		setPassword(newPwd);
		setHistory((h) => [newPwd, ...h.slice(0, 9)]);
	}, [config]);

	// Copy to clipboard
	const handleCopy = useCallback((pwd: string) => {
		navigator.clipboard.writeText(pwd);
	}, []);

	// Update config
	const updateConfig = useCallback((key: keyof PasswordConfig, value: unknown) => {
		setConfig((c) => ({ ...c, [key]: value }));
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Generated Password */}
			<div style={styles.password}>{password}</div>

			{/* Strength Indicator */}
			<div style={{ ...styles.strength, background: strength.color + '20', color: strength.color }}>
				🔐 {strength.label} — {strength.feedback[0]}
			</div>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleGenerate}>🎲 {t('passwordGen.generate')}</button>
				<button style={styles.btnSecondary} onClick={() => handleCopy(password)}>📋 {t('common.copy')}</button>
			</div>

			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.slider}>
					<span style={styles.label}>{t('passwordGen.length')}</span>
					<input
						type="range"
						min={4}
						max={64}
						value={config.length}
						onChange={(e) => updateConfig('length', parseInt(e.target.value))}
						style={{ flex: 1 }}
					/>
					<span style={{ ...styles.label, width: '30px', textAlign: 'right' }}>{config.length}</span>
				</div>
				<div style={{ ...styles.config, marginTop: '12px' }}>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.uppercase} onChange={(e) => updateConfig('uppercase', e.target.checked)} />
						ABC {t('passwordGen.uppercase')}
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.lowercase} onChange={(e) => updateConfig('lowercase', e.target.checked)} />
						abc {t('passwordGen.lowercase')}
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.numbers} onChange={(e) => updateConfig('numbers', e.target.checked)} />
						123 {t('passwordGen.numbers')}
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.symbols} onChange={(e) => updateConfig('symbols', e.target.checked)} />
						!@# {t('passwordGen.symbols')}
					</label>
					<label style={styles.checkbox}>
						<input type="checkbox" checked={config.excludeAmbiguous} onChange={(e) => updateConfig('excludeAmbiguous', e.target.checked)} />
						{t('passwordGen.excludeAmbiguous')}
					</label>
				</div>
			</Card>

			{/* History */}
			{history.length > 0 && (
				<Card variant="default" padding="sm">
					<div style={styles.label}>{t('passwordGen.history')}</div>
					<div style={{ ...styles.list, marginTop: '8px' }}>
						{history.map((pwd, i) => (
							<div key={i} style={styles.listItem}>
								<span style={{ opacity: 0.8 }}>{pwd.slice(0, 20)}{pwd.length > 20 ? '...' : ''}</span>
								<button style={styles.btnSecondary} onClick={() => handleCopy(pwd)}>📋</button>
							</div>
						))}
					</div>
				</Card>
			)}
		</div>
	);
};
