import { createContext, useCallback, useContext } from 'react';
import type React from 'react';
import type { ToolStateCodec, ToolStateDecode } from '../../kernel/core/storage-codec';
import { useSensitiveVaultState } from '../../kernel/hooks/use-sensitive-vault';
import { SensitiveVaultControls } from '../../components/sidepanel/SensitiveVaultControls';

export interface CryptoSensitiveState {
	aesPlaintext: string; aesCiphertext: string; aesKey: string;
	jwtToken: string; jwtSecret: string; jwtPayload: string;
	jwtResult: { header?: object; payload?: object; isValid?: boolean; error?: string } | null;
	rsaPublicKey: string; rsaPrivateKey: string;
}

const EMPTY_CRYPTO_STATE: CryptoSensitiveState = {
	aesPlaintext: '', aesCiphertext: '', aesKey: '', jwtToken: '', jwtSecret: '', jwtPayload: '{\n  "sub": "1234567890",\n  "name": "John Doe"\n}', jwtResult: null, rsaPublicKey: '', rsaPrivateKey: '',
};

const LEGACY_KEYS = [
	'halo_tool_state_crypto-aes-plain', 'halo_tool_state_crypto-aes-cipher', 'halo_tool_state_crypto-aes-key',
	'halo_tool_state_crypto-jwt-token', 'halo_tool_state_crypto-jwt-secret', 'halo_tool_state_crypto-jwt-payload', 'halo_tool_state_crypto-jwt-res',
	'halo_tool_state_crypto-rsa-pub', 'halo_tool_state_crypto-rsa-priv',
] as const;

function parseJwtResult(value: unknown): CryptoSensitiveState['jwtResult'] | undefined {
	if (value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) return undefined;
	const result = value as Record<string, unknown>;
	if (result.header !== undefined && (typeof result.header !== 'object' || result.header === null || Array.isArray(result.header))) return undefined;
	if (result.payload !== undefined && (typeof result.payload !== 'object' || result.payload === null || Array.isArray(result.payload))) return undefined;
	if (result.isValid !== undefined && typeof result.isValid !== 'boolean') return undefined;
	if (result.error !== undefined && typeof result.error !== 'string') return undefined;
	return {
		...(result.header === undefined ? {} : { header: result.header }),
		...(result.payload === undefined ? {} : { payload: result.payload }),
		...(result.isValid === undefined ? {} : { isValid: result.isValid }),
		...(result.error === undefined ? {} : { error: result.error }),
	};
}

function validate(value: unknown): ToolStateDecode<CryptoSensitiveState> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'invalid', reason: 'Crypto vault data is not a record.' };
	const item = value as Record<string, unknown>;
	const stringKeys: (keyof CryptoSensitiveState)[] = ['aesPlaintext', 'aesCiphertext', 'aesKey', 'jwtToken', 'jwtSecret', 'jwtPayload', 'rsaPublicKey', 'rsaPrivateKey'];
	const jwtResult = parseJwtResult(item.jwtResult);
	if (stringKeys.some((key) => typeof item[key] !== 'string') || jwtResult === undefined) return { kind: 'invalid', reason: 'Crypto vault fields are invalid.' };
	return { kind: 'valid', value: {
		aesPlaintext: item.aesPlaintext as string, aesCiphertext: item.aesCiphertext as string, aesKey: item.aesKey as string,
		jwtToken: item.jwtToken as string, jwtSecret: item.jwtSecret as string, jwtPayload: item.jwtPayload as string, jwtResult,
		rsaPublicKey: item.rsaPublicKey as string, rsaPrivateKey: item.rsaPrivateKey as string,
	} };
}

export const cryptoSensitiveCodec: ToolStateCodec<CryptoSensitiveState> = {
	decode(value) {
		if (typeof value !== 'object' || value === null || Array.isArray(value) || (value as Record<string, unknown>).version !== 1) return { kind: 'invalid', reason: 'Crypto vault data has an unsupported version.' };
		return validate((value as Record<string, unknown>).value);
	},
	encode(value) { return { version: 1, value }; },
};

function decodeLegacy(values: Record<string, unknown>): ToolStateDecode<CryptoSensitiveState> {
	const text = (key: string, fallback = '') => values[key] === undefined ? fallback : values[key];
	return validate({
		aesPlaintext: text(LEGACY_KEYS[0]), aesCiphertext: text(LEGACY_KEYS[1]), aesKey: text(LEGACY_KEYS[2]),
		jwtToken: text(LEGACY_KEYS[3]), jwtSecret: text(LEGACY_KEYS[4]), jwtPayload: text(LEGACY_KEYS[5], EMPTY_CRYPTO_STATE.jwtPayload),
		jwtResult: values[LEGACY_KEYS[6]] ?? null, rsaPublicKey: text(LEGACY_KEYS[7]), rsaPrivateKey: text(LEGACY_KEYS[8]),
	});
}

interface ContextValue { readonly state: CryptoSensitiveState; update(patch: Partial<CryptoSensitiveState>): void; }
const CryptoSensitiveContext = createContext<ContextValue | null>(null);

export function CryptoSensitiveProvider({ children }: { readonly children: React.ReactNode }) {
	const [state, setState, controls] = useSensitiveVaultState({ vaultId: 'crypto-workspace', legacyKeys: LEGACY_KEYS, initialValue: EMPTY_CRYPTO_STATE, codec: cryptoSensitiveCodec, decodeLegacy });
	const update = useCallback((patch: Partial<CryptoSensitiveState>) => setState((current) => ({ ...current, ...patch })), [setState]);
	return <CryptoSensitiveContext.Provider value={{ state, update }}>
		<SensitiveVaultControls controls={controls} exportName="halo-crypto-legacy.json" />
		{children}
	</CryptoSensitiveContext.Provider>;
}

export function useCryptoSensitiveState(): ContextValue {
	const context = useContext(CryptoSensitiveContext);
	if (!context) throw new Error('Crypto sensitive state requires its provider');
	return context;
}
