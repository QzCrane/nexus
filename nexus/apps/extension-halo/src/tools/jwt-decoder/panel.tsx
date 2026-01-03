// goal: JWT Decoder panel UI - parse and display JWT

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { decodeJwt, formatClaim, KNOWN_CLAIMS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const JwtDecoderPanel: React.FC = () => {
	const { t } = useTranslation();
	const [token, setToken] = useToolState<string>('jwt-decoder', '');


	const decoded = useMemo(() => decodeJwt(token), [token]);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<textarea
				style={styles.textarea}
				value={token}
				onChange={(e) => setToken(e.target.value)}
				placeholder={t('jwt.placeholder', { defaultValue: 'Paste JWT token here...' })}
			/>

			{/* Result */}
			{token && !decoded && (
				<div style={styles.error}>❌ {t('jwt.invalid', { defaultValue: 'Invalid JWT token' })}</div>
			)}

			{decoded && (
				<>
					{/* Header */}
					<div style={styles.section}>
						<div style={styles.sectionHeader}>
							<span style={styles.sectionTitle}>🔑 {t('jwt.header', { defaultValue: 'Header' })}</span>
							<span style={{ ...styles.badge, background: '#3b82f6' }}>{decoded.header.alg as string}</span>
						</div>
						<div style={styles.code}>{JSON.stringify(decoded.header, null, 2)}</div>
					</div>

					{/* Payload */}
					<div style={styles.section}>
						<div style={styles.sectionHeader}>
							<span style={styles.sectionTitle}>📦 {t('jwt.payload', { defaultValue: 'Payload' })}</span>
							{decoded.expiresAt && (
								<span style={{ ...styles.badge, ...(decoded.isExpired ? styles.expired : styles.valid) }}>
									{decoded.isExpired ? `⏰ ${t('jwt.expired', { defaultValue: 'Expired' })}` : `✅ ${t('jwt.valid', { defaultValue: 'Valid' })}`}
								</span>
							)}
						</div>
						{Object.entries(decoded.payload).map(([key, value]) => (
							<div key={key} style={styles.row}>
								<span style={styles.key}>{KNOWN_CLAIMS[key] || key}</span>
								<span style={styles.value}>{formatClaim(key, value)}</span>
							</div>
						))}
					</div>

					{/* Signature */}
					<div style={styles.section}>
						<div style={styles.sectionTitle}>🔒 {t('jwt.signature', { defaultValue: 'Signature' })}</div>
						<div style={{ ...styles.code, color: 'var(--halo-text-muted)', fontSize: '10px' }}>{decoded.signature}</div>
					</div>
				</>
			)}
		</div>
	);
};
