// goal: TOTP panel UI - 2FA code generator

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { TotpEntry, TotpCode } from './types';
import { generateTotp, parseOtpAuthUri, generateId } from './core';
import { styles } from './panel.styles';
import {
	createSerializedAsyncPoller,
	useOwnedClipboardCopy,
	useToolState,
} from '../../kernel';


export const TotpPanel: React.FC = () => {
	const { t } = useTranslation();
	const [entries, setEntries] = useToolState<TotpEntry[]>('totp', []);
	const [codes, setCodes] = useState<Record<string, TotpCode>>({});
	const [codeErrors, setCodeErrors] = useState<Record<string, string>>({});
	const [pollFailed, setPollFailed] = useState(false);
	const [showAdd, setShowAdd] = useState(false);
	const [secretInput, setSecretInput] = useToolState<string>('totp-secret', '');
	const [nameInput, setNameInput] = useToolState<string>('totp-name', '');
	const { copy, copyFailed } = useOwnedClipboardCopy<string>();

	// Update codes every second (with visibility pause optimization)
	useEffect(() => {
		const poller = createSerializedAsyncPoller(
			async () => {
			const newCodes: Record<string, TotpCode> = {};
			const newErrors: Record<string, string> = {};
			for (const entry of entries) {
				try {
					newCodes[entry.id] = await generateTotp(entry.secret, entry.digits, entry.period);
				} catch {
					newErrors[entry.id] = t('totp.generationFailed', {
						defaultValue: 'Invalid secret or TOTP parameters',
					});
				}
			}
				return { codes: newCodes, errors: newErrors };
			},
			(result) => {
				setCodes(result.codes);
				setCodeErrors(result.errors);
				setPollFailed(false);
			},
			() => setPollFailed(true),
			1000,
		);

		// Visibility-based optimization: pause when tab not visible
		const onVisibility = () => {
			if (document.visibilityState === 'visible') poller.start();
			else poller.stop();
		};

		document.addEventListener('visibilitychange', onVisibility);
		if (document.visibilityState === 'visible') poller.start();

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			poller.dispose();
		};
	}, [entries, t]);

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
	}, [secretInput, nameInput, setEntries, setSecretInput, setNameInput]);

	// Delete entry
	const handleDelete = useCallback((id: string) => {
		setEntries((e) => e.filter((x) => x.id !== id));
	}, [setEntries]);

	// Copy code
	const handleCopy = useCallback((entryId: string, code: string) => {
		void copy(entryId, code);
	}, [copy]);

	return (
		<div style={styles.wrapper}>
			{/* Add Button */}
			<button type="button" style={styles.btn} onClick={() => setShowAdd(!showAdd)}>
				{showAdd ? '✕' : '＋'} {showAdd ? t('totp.cancel') : t('totp.addAccount')}
			</button>

			{/* Add Form */}
			{showAdd && (
				<Card variant="default" padding="sm">
					<div style={styles.addForm}>
						<input style={styles.input} value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={t('totp.name')} />
						<input style={styles.input} value={secretInput} onChange={(e) => setSecretInput(e.target.value)} placeholder={t('totp.secretOrUri')} />
						<button type="button" style={styles.btn} onClick={handleAdd} disabled={!secretInput}>{t('totp.add')}</button>
					</div>
				</Card>
			)}

			{/* Entries */}
			<div style={styles.list}>
				{(pollFailed || copyFailed) && (
					<div style={styles.error} role="status">
						{t('totp.operationFailed', {
							defaultValue: 'TOTP update or clipboard access failed.',
						})}
					</div>
				)}
				{entries.length === 0 ? (
					<div style={styles.empty}>🔐 {t('totp.noAccounts')}</div>
				) : (
					entries.map((entry) => {
						const code = codes[entry.id];
						const codeError = codeErrors[entry.id];
						return (
							<div key={entry.id} style={styles.item}>
								<div style={styles.itemHeader}>
									<div>
										<div style={styles.name}>{entry.name}</div>
										{entry.issuer && <div style={styles.issuer}>{entry.issuer}</div>}
									</div>
									<div style={styles.row}>
										<button type="button" style={styles.btnSecondary} onClick={() => code && handleCopy(entry.id, code.code)}>📋</button>
										<button type="button" style={{ ...styles.btnSecondary, color: '#ef4444' }} onClick={() => handleDelete(entry.id)}>🗑️</button>
									</div>
								</div>
								<button
									type="button"
									disabled={!code}
									style={{ ...styles.code, width: '100%', padding: 0, border: 'none', background: 'transparent' }}
									onClick={() => code && handleCopy(entry.id, code.code)}
								>
									{code?.code || '------'}
								</button>
								{codeError && (
									<div style={styles.error} role="status">{codeError}</div>
								)}
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
