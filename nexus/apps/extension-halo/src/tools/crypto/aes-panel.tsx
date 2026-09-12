// goal: AES sub-panel component

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { generateAESKey, exportAESKey, importAESKey, encryptAES, decryptAES } from './core';
import { styles } from './panel.styles';
import { useCryptoSensitiveState } from './sensitive-state';


export const AESPanel: React.FC = () => {
	const { t } = useTranslation();
	const { state, update } = useCryptoSensitiveState();
	const { aesPlaintext: plaintext, aesCiphertext: ciphertext, aesKey: keyBase64 } = state;
	const setPlaintext = useCallback((value: string) => update({ aesPlaintext: value }), [update]);
	const setCiphertext = useCallback((value: string) => update({ aesCiphertext: value }), [update]);
	const setKeyBase64 = useCallback((value: string) => update({ aesKey: value }), [update]);

	const [error, setError] = useState('');

	const handleGenerateKey = useCallback(async () => {
		const key = await generateAESKey(256);
		setKeyBase64(await exportAESKey(key));
	}, [setKeyBase64]);

	const handleEncrypt = useCallback(async () => {
		try {
			setError('');
			const key = await importAESKey(keyBase64);
			const encrypted = await encryptAES(plaintext, key);
			setCiphertext(encrypted);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('crypto.aes.encryptFailed', { defaultValue: 'Encrypt failed' }));
		}
	}, [plaintext, keyBase64, t, setCiphertext]);

	const handleDecrypt = useCallback(async () => {
		try {
			setError('');
			const key = await importAESKey(keyBase64);
			const decrypted = await decryptAES(ciphertext, key);
			setPlaintext(decrypted);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('crypto.aes.decryptFailed', { defaultValue: 'Decrypt failed' }));
		}
	}, [ciphertext, keyBase64, t, setPlaintext]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<span style={styles.label}>{t('crypto.aes.key')}</span>
				<button type="button" style={styles.btnSecondary} onClick={handleGenerateKey}>{t('crypto.aes.generateKey')}</button>
			</div>
			<input style={styles.input} value={keyBase64} onChange={(e) => setKeyBase64(e.target.value)} placeholder={t('crypto.aes.keyPlaceholder')} />
			<textarea style={styles.textarea} value={plaintext} onChange={(e) => setPlaintext(e.target.value)} placeholder={t('crypto.aes.plaintext')} />
			<div style={styles.row}>
				<button type="button" style={styles.btn} onClick={handleEncrypt}>{t('crypto.aes.encrypt')}</button>
				<button type="button" style={styles.btnSecondary} onClick={handleDecrypt}>{t('crypto.aes.decrypt')}</button>
			</div>
			<textarea style={styles.textarea} value={ciphertext} onChange={(e) => setCiphertext(e.target.value)} placeholder={t('crypto.aes.ciphertext')} />
			{error && <div style={styles.error}>{error}</div>}
		</div>
	);
};
