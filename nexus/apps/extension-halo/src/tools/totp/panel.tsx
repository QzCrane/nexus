// goal: TOTP panel UI - 2FA code generator

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { TotpEntry, TotpCode } from './types';
import { generateTotp, parseOtpAuthUri, generateId } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const STORAGE_KEY = 'halo-totp-entries';

export const TotpPanel: React.FC = () => {
	const { t } = useTranslation();
	const [entries, setEntries] = useToolState<TotpEntry[]>('totp' as any, []);
	const [codes, setCodes] = useState<Record<string, TotpCode>>({});
	const [showAdd, setShowAdd] = useState(false);
	const [secretInput, setSecretInput] = useToolState<string>('totp-secret' as any, '');
	const [nameInput, setNameInput] = useToolState<string>('totp-name' as any, '');




	// Update codes every second
	useEffect(() => {
		const updateCodes = async () => {
			const newCodes: Record<string, TotpCode> = {};
			for (const entry of entries) {
				try {
					newCodes[entry.id] = await generateTotp(entry.secret, entry.digits, entry.period);
				} catch { /* ignore */ }
			}
			setCodes(newCodes);
		};
		updateCodes();
		const interval = setInterval(updateCodes, 1000);
		return () => clearInterval(interval);
	}, [entries]);

	// Add entry
	const handleAdd = useCallback(() => {
		// Try parsing as otpauth URI
		const parsed = parseOtpAuthUri(secretInput);
		const newEntry: TotpEntry = {
			id: generateId(),
			name: parsed?.name || nameInput || 'Account',
			issuer: parsed?.issuer || '',
			secret: parsed?.secret || secretInput.replace(/\s/g, ''),
			digits: parsed?.digits || 6,
			period: parsed?.period || 30,
		};
		setEntries((e) => [...e, newEntry]);
		setSecretInput('');
		setNameInput('');
		setShowAdd(false);
	}, [secretInput, nameInput]);

	// Delete entry
	const handleDelete = useCallback((id: string) => {
		setEntries((e) => e.filter((x) => x.id !== id));
	}, []);

	// Copy code
	const handleCopy = useCallback((code: string) => {
		navigator.clipboard.writeText(code);
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Add Button */}
			<button style={styles.btn} onClick={() => setShowAdd(!showAdd)}>
				{showAdd ? '✕' : '＋'} {showAdd ? t('totp.cancel') : t('totp.addAccount')}
			</button>

			{/* Add Form */}
			{showAdd && (
				<Card variant="default" padding="sm">
					<div style={styles.addForm}>
						<input style={styles.input} value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={t('totp.name')} />
						<input style={styles.input} value={secretInput} onChange={(e) => setSecretInput(e.target.value)} placeholder={t('totp.secretOrUri')} />
						<button style={styles.btn} onClick={handleAdd} disabled={!secretInput}>{t('totp.add')}</button>
					</div>
				</Card>
			)}

			{/* Entries */}
			<div style={styles.list}>
				{entries.length === 0 ? (
					<div style={styles.empty}>🔐 {t('totp.noAccounts')}</div>
				) : (
					entries.map((entry) => {
						const code = codes[entry.id];
						return (
							<div key={entry.id} style={styles.item}>
								<div style={styles.itemHeader}>
									<div>
										<div style={styles.name}>{entry.name}</div>
										{entry.issuer && <div style={styles.issuer}>{entry.issuer}</div>}
									</div>
									<div style={styles.row}>
										<button style={styles.btnSecondary} onClick={() => code && handleCopy(code.code)}>📋</button>
										<button style={{ ...styles.btnSecondary, color: '#ef4444' }} onClick={() => handleDelete(entry.id)}>🗑️</button>
									</div>
								</div>
								<div style={styles.code} onClick={() => code && handleCopy(code.code)}>{code?.code || '------'}</div>
								{code && (
									<div style={styles.timer}>
										<div style={styles.progress}>
											<div style={{ ...styles.progressBar, width: `${(code.remaining / code.period) * 100}%` }} />
										</div>
										<span>{code.remaining}s</span>
									</div>
								)}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
};
