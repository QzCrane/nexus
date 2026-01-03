// goal: Hash panel - shows ALL algorithms + HMAC + Verification

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateHash, generateHMAC, generateFileHash, verifyHash } from './core';
import { ALGORITHMS, type HashAlgorithm } from './types';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const HashPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('hash', '');
	const [hmacKey, setHmacKey] = useToolState<string>('hash-hmac' as any, '');
	const [expectedHash, setExpectedHash] = useToolState<string>('hash-verify' as any, '');
	const [uppercase, setUppercase] = useToolState<boolean>('hash-upper' as any, false);
	const [loading, setLoading] = useState(false);

	const [hashes, setHashes] = useState<Record<string, string>>({});
	const [verifyResult, setVerifyResult] = useState<{ match: boolean; algorithm?: string } | null>(null);
	const [copiedAlgo, setCopiedAlgo] = useState<string | null>(null);

	const calculateHashes = useCallback(async () => {
		if (!input.trim()) return setHashes({});
		setLoading(true);
		const results: Record<string, string> = {};
		await Promise.all(ALGORITHMS.map(async (algo) => {
			results[algo] = hmacKey && algo !== 'MD5' 
				? await generateHMAC(input, hmacKey, algo) 
				: await generateHash(input, algo);
		}));
		setHashes(results);
		setLoading(false);
	}, [input, hmacKey]);

	useEffect(() => {
		const timer = setTimeout(calculateHashes, 150);
		return () => clearTimeout(timer);
	}, [calculateHashes]);

	const handleVerify = useCallback(async () => {
		if (!input || !expectedHash) return setVerifyResult(null);
		const res = await verifyHash(input, expectedHash);
		setVerifyResult(res);
	}, [input, expectedHash]);

	useEffect(() => { handleVerify(); }, [handleVerify]);

	const copyHash = useCallback((algo: string, value: string) => {
		navigator.clipboard.writeText(uppercase ? value.toUpperCase() : value);
		setCopiedAlgo(algo);
		setTimeout(() => setCopiedAlgo(null), 1500);
	}, [uppercase]);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('hash.placeholder', { defaultValue: 'Enter text...' })} />
				<div style={{ ...styles.optionsRow, marginTop: '8px' }}>
					<input style={{ ...styles.verifyInput, flex: 1 }} value={hmacKey} onChange={(e) => setHmacKey(e.target.value)} placeholder={t('hash.hmacPlaceholder', { defaultValue: 'HMAC Key (Optional)' })} />
					<label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', marginLeft: '8px' }}>
						<input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} /> {t('hash.upper', { defaultValue: 'Upper' })}
					</label>
				</div>
			</Card>

			<div style={styles.resultsGrid}>
				{ALGORITHMS.map(algo => (
					<div key={algo} style={styles.resultRow}>
						<span style={styles.algoLabel}>{algo}</span>
						<span style={styles.hashValue}>{uppercase ? hashes[algo]?.toUpperCase() : hashes[algo]}</span>
						<button style={{ ...styles.btn, ...(copiedAlgo === algo ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }} onClick={() => copyHash(algo, hashes[algo] || '')}>
							{copiedAlgo === algo ? '✓' : t('hash.copy', { defaultValue: 'Copy' })}
						</button>
					</div>
				))}
			</div>

			<Card variant="default" padding="sm">
				<span style={styles.label}>{t('hash.verifyTitle', { defaultValue: 'Verify Hash' })}</span>
				<div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
					<input style={styles.verifyInput} value={expectedHash} onChange={(e) => setExpectedHash(e.target.value)} placeholder={t('hash.verifyPlaceholder', { defaultValue: 'Expected hash value...' })} />
					{verifyResult && (
						<div style={{ ...styles.verifyBadge, ...(verifyResult.match ? styles.pass : styles.fail) }}>
							{verifyResult.match ? `${t('hash.match', { defaultValue: 'MATCH' })} (${verifyResult.algorithm})` : t('hash.noMatch', { defaultValue: 'NO MATCH' })}
						</div>
					)}
				</div>
			</Card>
		</div>
	);
};
