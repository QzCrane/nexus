// goal: Crypto tool panel - orchestrates JWT/AES/RSA sub-panels

import React, { useState } from 'react';
import { Card } from '@nexus/ui-kit';
import type { CryptoMode } from './types';
import { styles } from './panel.styles';
import { JWTPanel } from './jwt-panel';
import { AESPanel } from './aes-panel';
import { RSAPanel } from './rsa-panel';

const MODES: { id: CryptoMode; label: string }[] = [
	{ id: 'jwt', label: 'JWT' },
	{ id: 'aes', label: 'AES' },
	{ id: 'rsa', label: 'RSA' },
];

export const CryptoPanel: React.FC = () => {
	const [mode, setMode] = useState<CryptoMode>('jwt');

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.tabs}>
					{MODES.map((m) => (
						<button
							key={m.id}
							style={{ ...styles.tab, ...(mode === m.id ? styles.active : styles.inactive) }}
							onClick={() => setMode(m.id)}
						>
							{m.label}
						</button>
					))}
				</div>
			</Card>
			{mode === 'jwt' && <JWTPanel />}
			{mode === 'aes' && <AESPanel />}
			{mode === 'rsa' && <RSAPanel />}
		</div>
	);
};
