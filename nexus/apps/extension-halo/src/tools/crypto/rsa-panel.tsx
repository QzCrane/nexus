// goal: RSA sub-panel component

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateRSAKeyPair } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const RSAPanel: React.FC = () => {
	const { t } = useTranslation();
	const [publicKey, setPublicKey] = useToolState<string>('crypto-rsa-pub', '');
	const [privateKey, setPrivateKey] = useToolState<string>('crypto-rsa-priv', '');

	const [loading, setLoading] = useState(false);

	const handleGenerate = useCallback(async () => {
		setLoading(true);
		const keyPair = await generateRSAKeyPair();
		setPublicKey(keyPair.publicKey);
		setPrivateKey(keyPair.privateKey);
		setLoading(false);
	}, [setPublicKey, setPrivateKey]);

	const copyKey = (key: string) => navigator.clipboard.writeText(key);

	return (
		<div style={styles.wrapper}>
			<button type="button" style={styles.btn} onClick={handleGenerate} disabled={loading}>
				{loading ? t('common.loading') : t('crypto.rsa.generate')}
			</button>
			{publicKey && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<span style={styles.label}>{t('crypto.rsa.publicKey')}</span>
						<button type="button" style={styles.btnSecondary} onClick={() => copyKey(publicKey)}>📋</button>
					</div>
					<pre style={styles.resultBox}>{publicKey}</pre>
					<div style={styles.row}>
						<span style={styles.label}>{t('crypto.rsa.privateKey')}</span>
						<button type="button" style={styles.btnSecondary} onClick={() => copyKey(privateKey)}>📋</button>
					</div>
					<pre style={styles.resultBox}>{privateKey}</pre>
				</Card>
			)}
		</div>
	);
};
