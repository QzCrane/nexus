// goal: aggregation point for all storage related repositories and utility functions

export { StorageRepository } from './repository.js';
export {
	getTabSessionConfig,
	setTabSessionConfig,
	removeTabSessionConfig,
	flushTabSessionConfig,
	hasTabSessionConfig,
} from './tab-session.js';
export { safeStorageGet, safeStorageSet, safeStorageRemove } from './safe-storage.js';
export type { StorageArea } from './safe-storage.js';
export { createSerializedQueue, createKeyedSerializedQueue } from './serialized-queue.js';
export type { SerializedQueue, KeyedSerializedQueue } from './serialized-queue.js';
