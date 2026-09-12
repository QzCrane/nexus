import { useCallback, useEffect, useRef, useState } from 'react';
import { ledgerRevisionKey, scheduleStorageOperation } from '../core/safe-storage';
import type { ToolStateCodec } from '../core/storage-codec';
import { readSensitiveVault, writeSensitiveVault } from '../core/sensitive-vault';

export type SensitiveStateStatus = 'loading' | 'memory' | 'legacy' | 'vault' | 'vault-dirty' | 'invalid' | 'error';

export interface SensitiveVaultControls {
	readonly status: SensitiveStateStatus;
	readonly error: string | null;
	readonly legacyRaw: Record<string, unknown> | null;
	readonly vaultRaw: unknown | null;
	saveToVault(): Promise<boolean>;
	deleteLegacyAfterVault(): Promise<boolean>;
}

interface Options<T> {
	readonly vaultId: string;
	readonly legacyKeys: readonly string[];
	readonly initialValue: T;
	readonly codec: ToolStateCodec<T>;
	readonly decodeLegacy?: (values: Record<string, unknown>) => ReturnType<ToolStateCodec<T>['decode']>;
}

function snapshot(value: unknown): string { return JSON.stringify(value); }

export function useSensitiveVaultState<T>(options: Options<T>) {
	const [value, setValue] = useState(options.initialValue);
	const valueRef = useRef(value);
	valueRef.current = value;
	const [status, setStatus] = useState<SensitiveStateStatus>('loading');
	const statusRef = useRef(status);
	statusRef.current = status;
	const [error, setError] = useState<string | null>(null);
	const legacyRawRef = useRef<Record<string, unknown> | null>(null);
	const vaultRawRef = useRef<unknown | null>(null);
	const legacyFingerprintRef = useRef<string | null>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const vaultId = options.vaultId;

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const current = optionsRef.current;
				const revisionKeys = current.legacyKeys.map(ledgerRevisionKey);
				const [vault, stored] = await Promise.all([
					readSensitiveVault(vaultId),
					chrome.storage.local.get([...current.legacyKeys, ...revisionKeys]),
				]);
				if (!active) return;
				const present = Object.fromEntries(current.legacyKeys.filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
				const fence = Object.fromEntries([...current.legacyKeys, ...revisionKeys].filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
				if (Object.keys(present).length > 0) {
					legacyRawRef.current = present;
					legacyFingerprintRef.current = vault?.migration?.sourceFingerprint ?? snapshot(fence);
				}
				if (vault) {
					vaultRawRef.current = vault.value;
					const decoded = current.codec.decode(vault.value);
					if (decoded.kind === 'invalid') { setError(decoded.reason); setStatus('invalid'); return; }
					setValue(decoded.value); setStatus('vault'); return;
				}
				if (Object.keys(present).length === 0) { setStatus('memory'); return; }
				const decoded = current.decodeLegacy ? current.decodeLegacy(present) : current.codec.decode(present[current.legacyKeys[0] ?? '']);
				if (decoded.kind === 'invalid') { setError(decoded.reason); setStatus('invalid'); return; }
				setValue(decoded.value); setStatus('legacy');
			} catch (reason) {
				if (active) { setError(reason instanceof Error ? reason.message : 'Sensitive storage could not be read'); setStatus('error'); }
			}
		})();
		return () => { active = false; };
	}, [vaultId]);

	const updateValue = useCallback((action: React.SetStateAction<T>) => {
		if (statusRef.current === 'loading' || statusRef.current === 'invalid' || statusRef.current === 'error') return;
		setValue((current) => typeof action === 'function' ? (action as (previous: T) => T)(current) : action);
		setStatus((current) => current === 'vault' ? 'vault-dirty' : current);
	}, []);

	const saveToVault = useCallback(async () => {
		try {
			if (statusRef.current === 'loading' || statusRef.current === 'invalid') return false;
			const current = optionsRef.current;
			const encoded = current.codec.encode(valueRef.current);
			const decoded = current.codec.decode(encoded);
			if (decoded.kind === 'invalid') throw new Error(decoded.reason);
			await writeSensitiveVault(current.vaultId, encoded, legacyFingerprintRef.current ? {
				legacyKeys: current.legacyKeys,
				sourceFingerprint: legacyFingerprintRef.current,
			} : undefined);
			setError(null); setStatus('vault'); return true;
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Sensitive vault save failed'); setStatus('error'); return false;
		}
	}, []);

	const deleteLegacyAfterVault = useCallback(async () => {
		try {
			if (status !== 'vault' || !legacyRawRef.current || !legacyFingerprintRef.current) return false;
			const current = optionsRef.current;
			const revisionKeys = current.legacyKeys.map(ledgerRevisionKey);
			const stored = await chrome.storage.local.get([...current.legacyKeys, ...revisionKeys]);
			const fence = Object.fromEntries([...current.legacyKeys, ...revisionKeys].filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
			if (snapshot(fence) !== legacyFingerprintRef.current) throw new Error('Legacy data changed; it was not deleted');
			const keys = current.legacyKeys.flatMap((key) => [key, ledgerRevisionKey(key)]);
			const mutation = scheduleStorageOperation('local', new TextEncoder().encode(JSON.stringify(keys)).byteLength, (area) => area.remove(keys), 0);
			if (!await mutation.completion) throw new Error('Legacy data deletion failed');
			const readback = await chrome.storage.local.get([...current.legacyKeys]);
			if (current.legacyKeys.some((key) => readback[key] !== undefined)) throw new Error('Legacy data deletion was not confirmed');
			legacyRawRef.current = null; legacyFingerprintRef.current = null; setError(null); return true;
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Legacy data was not deleted'); return false;
		}
	}, [status]);

	return [value, updateValue, { status, error, legacyRaw: legacyRawRef.current, vaultRaw: vaultRawRef.current, saveToVault, deleteLegacyAfterVault } satisfies SensitiveVaultControls] as const;
}
