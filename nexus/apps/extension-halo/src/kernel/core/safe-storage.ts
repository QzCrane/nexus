// goal: safe chrome storage wrapper with timeout and retry
// note: thin wrapper around @nexus/kernel safe-storage for backward compat

export { safeStorageGet, safeStorageSet, safeStorageRemove, scheduleStorageSet } from '@nexus/kernel';
export { conditionalLedgerWrite, readLedgerEntry, ledgerRevisionKey, scheduleStorageOperation } from '@nexus/kernel';
export type {
	StorageArea,
	StorageWrite,
	StorageWriteResult,
	StorageOptions,
	LedgerSnapshot,
	LedgerWriteOutcome,
	LedgerReadOptions,
	ConditionalLedgerWriteOptions,
} from '@nexus/kernel';
