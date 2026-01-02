// goal: AES sub-panel component

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { generateAESKey, exportAESKey, importAESKey, encryptAES, decryptAES } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const AESPanel: React.FC = () => {
	const { t } = useTranslation();
	const [plaintext, setPlaintext] = useToolState<string>('crypto-aes-plain' as any, '');
	const [ciphertext, setCiphertext] = useToolState<string>('crypto-aes-cipher' as any, '');
	const [keyBase64, setKeyBase64] = useToolState<string>('crypto-aes-key' as any, '');

	const [error, setError] = useState('');

	const handleGenerateKey = useCallback(async () => {
		const key = await generateAESKey(256);
		setKeyBase64(await exportAESKey(key));
	}, []);

	const handleEncrypt = useCallback(async () => {
		try {
			setError('');
			const key = await importAESKey(keyBase64);
			const encrypted = await encryptAES(plaintext, key);
			setCiphertext(encrypted);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Encrypt failed');
		}
	}, [plaintext, keyBase64]);

	const handleDecrypt = useCallback(async () => {
		try {
			setError('');
			const key = await importAESKey(keyBase64);
			const decrypted = await decryptAES(ciphertext, key);
			setPlaintext(decrypted);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Decrypt failed');
		}
	}, [ciphertext, keyBase64]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<span style={styles.label}>{t('crypto.aes.key')}</span>
				<button style={styles.btnSecondary} onClick={handleGenerateKey}>{t('crypto.aes.generateKey')}</button>
			</div>
			<input style={styles.input} value={keyBase64} onChange={(e) => setKeyBase64(e.target.value)} placeholder={t('crypto.aes.keyPlaceholder')} />
			<textarea style={styles.textarea} value={plaintext} onChange={(e) => setPlaintext(e.target.value)} placeholder={t('crypto.aes.plaintext')} />
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleEncrypt}>{t('crypto.aes.encrypt')}</button>
				<button style={styles.btnSecondary} onClick={handleDecrypt}>{t('crypto.aes.decrypt')}</button>
			</div>
			<textarea style={styles.textarea} value={ciphertext} onChange={(e) => setCiphertext(e.target.value)} placeholder={t('crypto.aes.ciphertext')} />
			{error && <div style={styles.error}>{error}</div>}
		</div>
	);
};
