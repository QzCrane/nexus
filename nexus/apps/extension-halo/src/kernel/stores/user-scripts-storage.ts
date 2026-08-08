// goal: one SidePanel-local authority for the halo_userscripts storage key
// inv: one Chrome listener/read lifecycle feeds every React projection; delayed hydration never overwrites a newer storage event

import type { SaaTScriptState } from '../services/saat-service';

export const USER_SCRIPTS_STORAGE_KEY = 'halo_userscripts';

export interface UserScriptsStorageSnapshot {
	ready: boolean;
	globalEnabled: boolean;
	readonly scripts: readonly SaaTScriptState[];
}

const EMPTY_SCRIPTS = Object.freeze([]) as readonly SaaTScriptState[];
const EMPTY_SNAPSHOT: UserScriptsStorageSnapshot = Object.freeze({
	ready: false,
	globalEnabled: false,
	scripts: EMPTY_SCRIPTS,
});
const FAILED_SNAPSHOT: UserScriptsStorageSnapshot = Object.freeze({
	ready: true,
	globalEnabled: false,
	scripts: EMPTY_SCRIPTS,
});

let snapshot: UserScriptsStorageSnapshot = EMPTY_SNAPSHOT;
let started = false;
let lifecycleEpoch = 0;
let eventRevision = 0;
const subscribers = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScripts(value: unknown): readonly SaaTScriptState[] {
	if (!isRecord(value) || !Array.isArray(value.scripts)) return EMPTY_SCRIPTS;
	const scripts = value.scripts
		.filter((candidate) => isRecord(candidate)
			&& typeof candidate.id === 'string'
			&& typeof candidate.enabled === 'boolean')
		.map((candidate) => Object.freeze({ ...candidate }) as SaaTScriptState);
	return scripts.length === 0 ? EMPTY_SCRIPTS : Object.freeze(scripts);
}

function parseSnapshot(value: unknown): UserScriptsStorageSnapshot {
	// A missing key means the product has never persisted a preference, so keep
	// the historical default-on behavior. An actual read failure is different
	// evidence and is handled fail-closed by the hydration catch path below.
	const globalEnabled = isRecord(value) && typeof value.globalEnabled === 'boolean'
		? value.globalEnabled
		: true;
	return Object.freeze({
		ready: true,
		globalEnabled,
		scripts: readScripts(value),
	});
}

function publish(next: UserScriptsStorageSnapshot): void {
	if (snapshot === next) return;
	snapshot = next;
	for (const listener of subscribers) listener();
}

const onStorageChanged = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
): void => {
	if (!started || areaName !== 'local') return;
	const change = changes[USER_SCRIPTS_STORAGE_KEY];
	if (!change) return;
	eventRevision += 1;
	publish(parseSnapshot(change.newValue));
};

function start(): void {
	if (started) return;
	started = true;
	const epoch = ++lifecycleEpoch;
	const revisionBeforeHydration = eventRevision;
	chrome.storage.onChanged.addListener(onStorageChanged);
	void chrome.storage.local.get(USER_SCRIPTS_STORAGE_KEY).then((result) => {
		if (
			!started
			|| epoch !== lifecycleEpoch
			|| eventRevision !== revisionBeforeHydration
		) return;
		publish(parseSnapshot(result[USER_SCRIPTS_STORAGE_KEY]));
	}).catch((error: unknown) => {
		if (!started || epoch !== lifecycleEpoch) return;
		console.error('[HALO:UserScriptsStorage] Initial hydration failed', error);
		// Storage failure is not equivalent to an absent key. Fail closed instead
		// of inventing the default-enabled state from missing evidence.
		publish(FAILED_SNAPSHOT);
	});
}

function stop(): void {
	if (!started) return;
	started = false;
	lifecycleEpoch += 1;
	chrome.storage.onChanged.removeListener(onStorageChanged);
	snapshot = EMPTY_SNAPSHOT;
}

export function subscribeUserScriptsStorage(listener: () => void): () => void {
	subscribers.add(listener);
	start();
	return () => {
		subscribers.delete(listener);
		if (subscribers.size === 0) stop();
	};
}

export function getUserScriptsStorageSnapshot(): UserScriptsStorageSnapshot {
	return snapshot;
}

export const userScriptsStorageTestApi = {
	parseSnapshot,
	reset(): void {
		subscribers.clear();
		stop();
		eventRevision = 0;
		snapshot = EMPTY_SNAPSHOT;
	},
};
