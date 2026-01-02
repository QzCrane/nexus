// goal: Password Generator panel UI with Bulk Generation and Strength analysis

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PasswordConfig } from './types';
import { generatePassword, generatePasswords, evaluateStrength, DEFAULT_CONFIG } from './core';
import { styles } from './panel.styles';

export const PasswordGenPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useState<PasswordConfig>(DEFAULT_CONFIG);
	const [password, setPassword] = useState(() => generatePassword(DEFAULT_CONFIG));
	const [bulkPasswords, setBulkPasswords] = useState<string[]>([]);
	const [showBulk, setShowBulk] = useState(false);
	const [toast, setToast] = useState<string | null>(null);

	const strength = useMemo(() => evaluateStrength(password), [password]);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleGenerate = useCallback(() => {
		if (showBulk) {
			setBulkPasswords(generatePasswords(config, 10));
		} else {
			const newPwd = generatePassword(config);
			setPassword(newPwd);
		}
	}, [config, showBulk]);

	const handleCopy = useCallback((pwd: string) => {
		navigator.clipboard.writeText(pwd);
		showToast(t('common.copied'));
	}, [showToast, t]);

	const updateConfig = useCallback((key: keyof PasswordConfig, value: unknown) => {
		setConfig((c) => ({ ...c, [key]: value }));
	}, []);

	// Auto-regenerate on config change
	useEffect(() => {
		handleGenerate();
	}, [config, showBulk]);

	return (
		<div style={styles.wrapper}>
			{/* Mode Toggle */}
			<div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
				<button 
					style={{ ...styles.btn, flex: 1, ...(showBulk ? styles.btnSecondary : {}) }}
					onClick={() => setShowBulk(false)}
				>
					Single
				</button>
				<button 
					style={{ ...styles.btn, flex: 1, ...(!showBulk ? styles.btnSecondary : {}) }}
					onClick={() => setShowBulk(true)}
				>
					Bulk (10)
				</button>
			</div>

			{!showBulk ? (
				<>
					<div style={styles.password}>{password}</div>
					<div style={{ ...styles.strength, background: strength.color + '20', color: strength.color }}>
						🔐 {strength.label} — {strength.feedback[0]}
					</div>
					<div style={styles.row}>
						<button style={{ ...styles.btn, flex: 2 }} onClick={handleGenerate}>🎲 Regenerate</button>
						<button style={{ ...styles.btnSecondary, flex: 1 }} onClick={() => handleCopy(password)}>📋 Copy</button>
					</div>
				</>
			) : (
				<Card variant="default" padding="sm">
					<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
						{bulkPasswords.map((pwd, i) => (
							<div key={i} style={{ ...styles.listItem, padding: '6px 8px' }}>
								<span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{pwd}</span>
								<button style={{ ...styles.btnSecondary, padding: '2px 8px' }} onClick={() => handleCopy(pwd)}>📋</button>
							</div>
						))}
					</div>
					<button style={{ ...styles.btn, width: '100%', marginTop: '8px' }} onClick={handleGenerate}>🔄 Refresh All</button>
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
						No (0O1lI)
					</label>
				</div>
			</Card>

			{toast && (
				<div style={{ 
					position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)',
					background: 'var(--halo-accent)', color: '#fff', padding: '8px 16px', borderRadius: '20px', fontSize: '12px'
				}}>
					{toast}
				</div>
			)}
		</div>
	);
};
