// goal: one reactive SidePanel authority for the halo_userscripts storage key
// inv: every SidePanel consumer shares one event-first external-store snapshot

import { subscribeHaloStorageChanges } from '../../kernel/core/storage-change-bus';
import { STORAGE_KEY } from './storage';
import {
	EMPTY_USER_SCRIPTS_STORAGE_SNAPSHOT,
	FAILED_USER_SCRIPTS_STORAGE_SNAPSHOT,
	parseUserScriptsStorageValue,
	type UserScriptsStorageSnapshot,
} from './storage-schema';

export {
	parseUserScriptsStorageValue,
	type UserScriptsSnapshotScript,
	type UserScriptsStorageSnapshot,
	type UserScriptsToolbarAction,
	type UserScriptsToolbarSnapshot,
} from './storage-schema';

let snapshot = EMPTY_USER_SCRIPTS_STORAGE_SNAPSHOT;
let started = false;
let lifecycleEpoch = 0;
let eventRevision = 0;
let readRevision = 0;
let unsubscribeStorageChanges: (() => void) | null = null;
const subscribers = new Set<() => void>();

function publish(next: UserScriptsStorageSnapshot): void {
	if (snapshot === next) return;
	snapshot = next;
	for (const subscriber of [...subscribers]) subscriber();
}

const onStorageChanged = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
): void => {
	if (!started || areaName !== 'local') return;
	const change = changes[STORAGE_KEY];
	if (!change) return;
	eventRevision += 1;
	publish(parseUserScriptsStorageValue(change.newValue));
};

async function readCurrent(epoch: number, request: number, beforeEvent: number): Promise<void> {
	try {
		const result = await chrome.storage.local.get(STORAGE_KEY);
		if (!started
			|| lifecycleEpoch !== epoch
			|| readRevision !== request
			|| eventRevision !== beforeEvent) return;
		publish(parseUserScriptsStorageValue(result[STORAGE_KEY]));
	} catch (error: unknown) {
		if (!started
			|| lifecycleEpoch !== epoch
			|| readRevision !== request
			|| eventRevision !== beforeEvent) return;
		console.error('[HALO:UserScriptsStorage] Hydration failed', error);
		publish(FAILED_USER_SCRIPTS_STORAGE_SNAPSHOT);
	}
}

function start(): void {
	if (started) return;
	started = true;
	const epoch = ++lifecycleEpoch;
	// Event-first: listener attaches before the physical read begins.
	unsubscribeStorageChanges = subscribeHaloStorageChanges(onStorageChanged);
	const request = ++readRevision;
	void readCurrent(epoch, request, eventRevision);
}

function stop(): void {
	if (!started) return;
	started = false;
	lifecycleEpoch += 1;
	readRevision += 1;
	unsubscribeStorageChanges?.();
	unsubscribeStorageChanges = null;
	snapshot = EMPTY_USER_SCRIPTS_STORAGE_SNAPSHOT;
}

export function subscribeUserScriptsStorage(subscriber: () => void): () => void {
	subscribers.add(subscriber);
	start();
	return () => {
		subscribers.delete(subscriber);
		if (subscribers.size === 0) stop();
	};
}

export function getUserScriptsStorageSnapshot(): UserScriptsStorageSnapshot {
	return snapshot;
}

export async function refreshUserScriptsStorage(): Promise<void> {
	if (!started) return;
	const epoch = lifecycleEpoch;
	const request = ++readRevision;
	await readCurrent(epoch, request, eventRevision);
}

export const userScriptsStorageAuthorityTestApi = {
	reset(): void {
		subscribers.clear();
		stop();
		eventRevision = 0;
		readRevision = 0;
		snapshot = EMPTY_USER_SCRIPTS_STORAGE_SNAPSHOT;
	},
};
