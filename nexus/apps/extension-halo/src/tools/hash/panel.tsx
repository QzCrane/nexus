// goal: Hash panel - shows ALL algorithms + HMAC + Verification

import type React from 'react';
import { useState, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateHash, generateHMAC, verifyHash } from './core';
import { ALGORITHMS, } from './types';
import { styles } from './panel.styles';
import { useOwnedClipboardCopy, useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';


export const HashPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('hash', '');
	const [hmacKey, setHmacKey] = useToolState<string>('hash-hmac', '');
	const [expectedHash, setExpectedHash] = useToolState<string>('hash-verify', '');
	const [uppercase, setUppercase] = useToolState<boolean>('hash-upper', false);
	const calculationTask = useOwnedAsyncTask();
	const verificationTask = useOwnedAsyncTask();

	const [hashes, setHashes] = useState<Record<string, string>>({});
	const [verifyResult, setVerifyResult] = useState<{ match: boolean; algorithm?: string } | null>(null);
	const [calculationFailed, setCalculationFailed] = useState(false);
	const [verificationFailed, setVerificationFailed] = useState(false);
	const { copiedKey: copiedAlgo, copy, copyFailed } =
		useOwnedClipboardCopy<string>();

	useEffect(() => {
		setCalculationFailed(false);
		if (!input.trim()) {
			calculationTask.cancel();
			setHashes({});
			return;
		}
		const timer = setTimeout(() => {
			void calculationTask.run(() => Promise.all(ALGORITHMS.map(async (algorithm) => {
				const hash = hmacKey && algorithm !== 'MD5'
					? await generateHMAC(input, hmacKey, algorithm)
					: await generateHash(input, algorithm);
				return [algorithm, hash] as const;
			}))).then((outcome) => {
				if (outcome.kind === 'succeeded') setHashes(Object.fromEntries(outcome.value));
				else if (outcome.kind === 'failed') {
					setHashes({});
					setCalculationFailed(true);
				}
			});
		}, 150);
		return () => {
			clearTimeout(timer);
			calculationTask.cancel();
		};
	}, [input, hmacKey, calculationTask.run, calculationTask.cancel]);

	useEffect(() => {
		setVerificationFailed(false);
		if (!input || !expectedHash) {
			verificationTask.cancel();
			setVerifyResult(null);
			return;
		}
		void verificationTask.run(() => verifyHash(input, expectedHash)).then((outcome) => {
			if (outcome.kind === 'succeeded') setVerifyResult(outcome.value);
			else if (outcome.kind === 'failed') {
				setVerifyResult(null);
				setVerificationFailed(true);
			}
		});
		return verificationTask.cancel;
	}, [input, expectedHash, verificationTask.run, verificationTask.cancel]);

	const copyHash = (algorithm: string, value: string): void => {
		void copy(
			algorithm,
			uppercase ? value.toUpperCase() : value,
		);
	};

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

			<div style={styles.resultsGrid} aria-busy={calculationTask.phase === 'running'}>
				{ALGORITHMS.map(algo => (
					<div key={algo} style={styles.resultRow}>
						<span style={styles.algoLabel}>{algo}</span>
						<span style={styles.hashValue}>{uppercase ? hashes[algo]?.toUpperCase() : hashes[algo]}</span>
						<button
							type="button"
							disabled={calculationTask.phase === 'running' || !hashes[algo]}
							style={{ ...styles.btn, ...(copiedAlgo === algo ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }}
							onClick={() => copyHash(algo, hashes[algo] || '')}
						>
							{copiedAlgo === algo ? '✓' : t('hash.copy', { defaultValue: 'Copy' })}
						</button>
					</div>
				))}
			</div>
			{(calculationFailed || verificationFailed || copyFailed || calculationTask.error !== null || verificationTask.error !== null) && (
				<div role="status" style={{ color: 'var(--halo-error, #ef4444)', fontSize: '12px' }}>
					{t('hash.operationFailed', {
						defaultValue: 'Hash operation failed. Check the input and clipboard permission.',
					})}
				</div>
			)}

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
