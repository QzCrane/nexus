// goal: TOTP panel UI - 2FA code generator
// eff: 1Hz display updates reuse each code for its whole counter epoch

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { TotpEntry, TotpCode } from './types';
import {
	base32ToBytes,
	generateId,
	generateTotp,
	parseOtpAuthUri,
	totpCounter,
	totpRemaining,
} from './core';
import { styles } from './panel.styles';
import {
	createSerializedAsyncPoller,
	useOwnedClipboardCopy,
	useToolState,
} from '../../kernel';

interface CachedTotpCode {
	counter: number;
	signature: string;
	code: string;
}

function cacheSignature(entry: TotpEntry): string {
	return `${entry.secret}\u0000${entry.digits}\u0000${entry.period}\u0000${entry.algorithm ?? 'SHA1'}`;
}

export const TotpPanel: React.FC = () => {
	const { t } = useTranslation();
	// Saved authenticator accounts must survive browser restarts. Import drafts
	// remain ephemeral; changing saved-secret retention requires an explicit vault.
	const [entries, setEntries] = useToolState<TotpEntry[]>('totp', []);
	const [codes, setCodes] = useState<Record<string, TotpCode>>({});
	const [codeErrors, setCodeErrors] = useState<Record<string, string>>({});
	const [pollFailed, setPollFailed] = useState(false);
	const [showAdd, setShowAdd] = useState(false);
	const [secretInput, setSecretInput] = useState('');
	const [addError, setAddError] = useState('');
	const [nameInput, setNameInput] = useState('');
	const { copy, copyFailed } = useOwnedClipboardCopy<string>();
	const codeCacheRef = useRef(new Map<string, CachedTotpCode>());

	// Remaining time changes every second, but HMAC output changes only when the
	// TOTP counter changes. Cache one code per entry/counter and derive remaining
	// seconds from the wall clock without re-importing an HMAC key every tick.
	// New-epoch HMAC work stays sequential so account count cannot turn one 30s
	// boundary into an unbounded WebCrypto burst.
	useEffect(() => {
		const poller = createSerializedAsyncPoller(
			async () => {
				const now = Date.now();
				const liveIds = new Set(entries.map((entry) => entry.id));
				for (const id of codeCacheRef.current.keys()) {
					if (!liveIds.has(id)) codeCacheRef.current.delete(id);
				}

				const newCodes: Record<string, TotpCode> = {};
				const newErrors: Record<string, string> = {};
				for (const entry of entries) {
					const signature = cacheSignature(entry);
					try {
						const counter = totpCounter(now, entry.period);
						const cached = codeCacheRef.current.get(entry.id);
						let code = cached?.code;
						if (!cached || cached.counter !== counter || cached.signature !== signature) {
							const generated = await generateTotp(entry.secret, entry.digits, entry.period, now, entry.algorithm ?? 'SHA1');
							code = generated.code;
							codeCacheRef.current.set(entry.id, { counter, signature, code });
						}
						newCodes[entry.id] = {
							code: code ?? '',
							remaining: totpRemaining(now, entry.period),
							period: entry.period,
						};
					} catch {
						codeCacheRef.current.delete(entry.id);
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

	const handleAdd = useCallback(() => {
		const parsed = parseOtpAuthUri(secretInput);
		if (/^otpauth:/iu.test(secretInput) && !parsed) {
			setAddError('Invalid or unsupported authenticator URI; nothing was saved.');
			return;
		}
		try { base32ToBytes(parsed?.secret ?? secretInput); }
		catch { setAddError('Invalid Base32 secret; nothing was saved.'); return; }
		setAddError('');
		const newEntry: TotpEntry = {
			id: generateId(),
			name: parsed?.name || nameInput || 'Account',
			issuer: parsed?.issuer || '',
			secret: parsed?.secret || secretInput.replace(/\s/g, ''),
			digits: parsed?.digits || 6,
			period: parsed?.period ?? 30,
			algorithm: parsed?.algorithm ?? 'SHA1',
		};
		setEntries((current) => [...current, newEntry]);
		setSecretInput('');
		setNameInput('');
		setShowAdd(false);
	}, [secretInput, nameInput, setEntries]);

	const handleDelete = useCallback((id: string) => {
		codeCacheRef.current.delete(id);
		setEntries((current) => current.filter((entry) => entry.id !== id));
	}, [setEntries]);

	const handleCopy = useCallback((entryId: string, code: string) => {
		void copy(entryId, code);
	}, [copy]);

	return (
		<div style={styles.wrapper}>
			<button type="button" style={styles.btn} onClick={() => setShowAdd(!showAdd)}>
				{showAdd ? '✕' : '＋'} {showAdd ? t('totp.cancel') : t('totp.addAccount')}
			</button>

			{showAdd && (
				<Card variant="default" padding="sm">
					<div style={styles.addForm}>
						{addError && <div role="alert" style={styles.error}>{addError}</div>}
						<input style={styles.input} value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={t('totp.name')} />
						<input type="password" autoComplete="off" style={styles.input} value={secretInput} onChange={(e) => setSecretInput(e.target.value)} placeholder={t('totp.secretOrUri')} />
						<button type="button" style={styles.btn} onClick={handleAdd} disabled={!secretInput}>{t('totp.add')}</button>
					</div>
				</Card>
			)}

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
										<div style={styles.issuer}>{entry.algorithm ?? 'Legacy SHA1 — reimport the original URI if the issuer uses another algorithm'}</div>
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
