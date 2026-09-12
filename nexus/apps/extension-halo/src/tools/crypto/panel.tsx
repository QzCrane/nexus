// goal: Crypto tool panel - orchestrates JWT/AES/RSA sub-panels
import { useTranslation } from '../../i18n';

import type React from 'react';
import { Card } from '@nexus/ui-kit';
import type { CryptoMode } from './types';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

import { JWTPanel } from './jwt-panel';
import { AESPanel } from './aes-panel';
import { RSAPanel } from './rsa-panel';
import { CryptoSensitiveProvider } from './sensitive-state';

const MODES: { id: CryptoMode; label: string }[] = [
	{ id: 'jwt', label: 'JWT' },
	{ id: 'aes', label: 'AES' },
	{ id: 'rsa', label: 'RSA' },
];
const cryptoModeCodec: ToolStateCodec<CryptoMode> = {
	decode(value) { return value === 'jwt' || value === 'aes' || value === 'rsa' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Crypto mode is unsupported.' }; },
	encode(value) { return value; },
};

export const CryptoPanel: React.FC = () => {
    const { t } = useTranslation(); // Use global translation
	const [mode, setMode, , modeRecovery] = useToolState<CryptoMode>('crypto', 'jwt', { codec: cryptoModeCodec });


	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="jwt" exportName="halo-crypto-mode-damaged.json" />
			<Card variant="default" padding="sm">
				<div style={styles.tabs}>
					{MODES.map((m) => (
						<button type="button"
							key={m.id}
							style={{ ...styles.tab, ...(mode === m.id ? styles.active : styles.inactive) }}
							onClick={() => setMode(m.id)}
						>
							{t(`crypto.modes.${m.id}`, { defaultValue: m.label })}
						</button>
					))}
				</div>
			</Card>
			<CryptoSensitiveProvider>
				{mode === 'jwt' && <JWTPanel />}
				{mode === 'aes' && <AESPanel />}
				{mode === 'rsa' && <RSAPanel />}
			</CryptoSensitiveProvider>
		</div>
	);
};
