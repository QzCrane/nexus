// goal: JWT sub-panel component

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { decodeJWT, verifyJWTHS, createJWTHS } from './core';
import { styles } from './panel.styles';

export const JWTPanel: React.FC = () => {
	const { t } = useTranslation();
	const [token, setToken] = useState('');
	const [secret, setSecret] = useState('');
	const [result, setResult] = useState<{ header?: object; payload?: object; isValid?: boolean; error?: string } | null>(null);
	const [createMode, setCreateMode] = useState(false);
	const [payloadInput, setPayloadInput] = useState('{\n  "sub": "1234567890",\n  "name": "John Doe"\n}');

	const handleDecode = useCallback(() => {
		const decoded = decodeJWT(token);
		setResult({ header: decoded.header, payload: decoded.payload, error: decoded.error });
	}, [token]);

	const handleVerify = useCallback(async () => {
		if (!secret) return;
		const verified = await verifyJWTHS(token, secret);
		setResult({ header: verified.header, payload: verified.payload, isValid: verified.isValid, error: verified.error });
	}, [token, secret]);

	const handleCreate = useCallback(async () => {
		try {
			const payload = JSON.parse(payloadInput);
			const jwt = await createJWTHS(payload, secret);
			setToken(jwt);
			setResult({ header: { alg: 'HS256', typ: 'JWT' }, payload });
		} catch (e) {
			setResult({ error: e instanceof Error ? e.message : 'Invalid payload JSON' });
		}
	}, [payloadInput, secret]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<button style={{ ...styles.btnSecondary, ...(createMode ? {} : { background: 'var(--halo-accent)', color: '#fff' }) }} onClick={() => setCreateMode(false)}>
					{t('crypto.jwt.decode')}
				</button>
				<button style={{ ...styles.btnSecondary, ...(createMode ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }} onClick={() => setCreateMode(true)}>
					{t('crypto.jwt.create')}
				</button>
			</div>

			{createMode ? (
				<>
					<div>
						<span style={styles.label}>{t('crypto.jwt.payload')}</span>
						<textarea style={styles.textarea} value={payloadInput} onChange={(e) => setPayloadInput(e.target.value)} placeholder='{"key": "value"}' />
					</div>
					<div>
						<span style={styles.label}>{t('crypto.jwt.secret')}</span>
						<input style={styles.input} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('crypto.jwt.secretPlaceholder')} />
					</div>
					<button style={styles.btn} onClick={handleCreate}>{t('crypto.jwt.generate')}</button>
				</>
			) : (
				<>
					<div>
						<span style={styles.label}>{t('crypto.jwt.token')}</span>
						<textarea style={styles.textarea} value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
					</div>
					<div style={styles.row}>
						<button style={styles.btn} onClick={handleDecode}>{t('crypto.jwt.decode')}</button>
						<input style={{ ...styles.input, flex: 1 }} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('crypto.jwt.secretPlaceholder')} />
						<button style={styles.btnSecondary} onClick={handleVerify}>{t('crypto.jwt.verify')}</button>
					</div>
				</>
			)}

			{result && (
				<Card variant="default" padding="sm">
					{result.isValid !== undefined && (
						<div style={result.isValid ? styles.success : styles.error}>
							{result.isValid ? '✓ ' + t('crypto.jwt.valid') : '✗ ' + t('crypto.jwt.invalid')}
						</div>
					)}
					{result.error && <div style={styles.error}>{result.error}</div>}
					{result.header && <><span style={styles.label}>Header</span><pre style={styles.resultBox}>{JSON.stringify(result.header, null, 2)}</pre></>}
					{result.payload && <><span style={styles.label}>Payload</span><pre style={styles.resultBox}>{JSON.stringify(result.payload, null, 2)}</pre></>}
				</Card>
			)}
		</div>
	);
};
