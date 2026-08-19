import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { subscribeHaloStorageChanges } from '../../kernel/core/storage-change-bus';
import {
	BACKGROUND_ACTIVE_ONLY_MAP,
	BACKGROUND_PLUGIN_IDS,
} from '../../kernel/registry/_generated-background-active';
import {
	RELEASE_ACTIVE_SERVICE_CONTRACTS,
	RELEASE_SCRIPT_RUNTIME_IDS,
} from '../../kernel/registry/_generated-release-admission';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
	type UserScriptsStorageSnapshot,
} from '../../system/userscripts/storage-authority';

export interface ActiveServiceStorageState {
	ready: boolean;
	enabledById: Readonly<Record<string, boolean>>;
}

type ActiveServiceContract = (typeof RELEASE_ACTIVE_SERVICE_CONTRACTS)[number];
interface StorageBackedActiveServiceContract {
	readonly id: string;
	readonly kind: 'storage-enabled' | 'saat-registry';
	readonly area: 'local' | 'sync';
	readonly key: string;
	readonly defaultEnabled?: boolean;
	readonly owner: string;
	readonly readiness: string;
	readonly disposer: string;
}

const SUPPORTED_ACTIVE_SERVICE_KINDS = new Set([
	'storage-enabled',
	'userscripts-authority',
	'saat-registry',
]);
for (const contract of RELEASE_ACTIVE_SERVICE_CONTRACTS) {
	if (!SUPPORTED_ACTIVE_SERVICE_KINDS.has(contract.kind)) {
		throw new Error(`Unsupported generated active-service kind: ${String(contract.kind)}`);
	}
	for (const field of ['owner', 'readiness', 'disposer'] as const) {
		if (typeof contract[field] !== 'string' || contract[field].trim().length === 0) {
			throw new Error(`${contract.id}: generated active-service ${field} is missing`);
		}
	}
}

const STORAGE_BACKED_CONTRACTS = RELEASE_ACTIVE_SERVICE_CONTRACTS.filter(
	(contract) => 'area' in contract && 'key' in contract,
) as readonly StorageBackedActiveServiceContract[];
const USERSCRIPTS_AUTHORITY_IDS = RELEASE_ACTIVE_SERVICE_CONTRACTS
	.filter((contract) => contract.kind === 'userscripts-authority')
	.map((contract) => contract.id);
const RELEASE_SCRIPT_RUNTIME_ID_SET = new Set<string>(RELEASE_SCRIPT_RUNTIME_IDS);

function storageEventKey(area: 'local' | 'sync', key: string): string {
	return `${area}:${key}`;
}

function groupStorageBackedContracts(): ReadonlyMap<string, readonly StorageBackedActiveServiceContract[]> {
	const grouped = new Map<string, StorageBackedActiveServiceContract[]>();
	for (const contract of STORAGE_BACKED_CONTRACTS) {
		const eventKey = storageEventKey(contract.area, contract.key);
		const bucket = grouped.get(eventKey) ?? [];
		bucket.push(contract);
		grouped.set(eventKey, bucket);
	}
	return grouped;
}

const STORAGE_CONTRACTS_BY_EVENT = groupStorageBackedContracts();
const STORAGE_KEYS_BY_AREA = Object.freeze({
	local: [...new Set(
		STORAGE_BACKED_CONTRACTS
			.filter((contract) => contract.area === 'local')
			.map((contract) => contract.key),
	)],
	sync: [...new Set(
		STORAGE_BACKED_CONTRACTS
			.filter((contract) => contract.area === 'sync')
			.map((contract) => contract.key),
	)],
});

const EMPTY_STORAGE_STATE: ActiveServiceStorageState = {
	ready: false,
	enabledById: Object.freeze({}),
};

const TRUE_BACKGROUND_IDS = Object.freeze(BACKGROUND_PLUGIN_IDS.filter(
	(id) => BACKGROUND_ACTIVE_ONLY_MAP[id] === false,
));

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEnabled(value: unknown, fallback: boolean): boolean {
	if (!isRecord(value) || typeof value.enabled !== 'boolean') return fallback;
	return value.enabled;
}

export function isSaatRegistryServiceEnabled(value: unknown, serviceId: string): boolean {
	if (!isRecord(value) || value.globalEnabled !== true || !Array.isArray(value.scripts)) return false;
	return value.scripts.some((script) => isRecord(script)
		&& script.managedBy === 'saat-tool'
		&& script.saatToolId === serviceId
		&& script.enabled === true);
}

function readStorageBackedContractEnabled(
	contract: StorageBackedActiveServiceContract,
	value: unknown,
): boolean {
	if (contract.kind === 'storage-enabled') {
		return readEnabled(value, contract.defaultEnabled ?? false);
	}
	return isSaatRegistryServiceEnabled(value, contract.id);
}

function sameEnabledById(
	left: Readonly<Record<string, boolean>>,
	right: Readonly<Record<string, boolean>>,
): boolean {
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((id) => right[id] === left[id]);
}

function sameStorageState(
	left: ActiveServiceStorageState,
	right: ActiveServiceStorageState,
): boolean {
	return left.ready === right.ready && sameEnabledById(left.enabledById, right.enabledById);
}

export function mergeInitialActiveServiceStorageState(
	current: ActiveServiceStorageState,
	initial: ActiveServiceStorageState,
	eventOwnedIds: ReadonlySet<string>,
): ActiveServiceStorageState {
	const enabledById: Record<string, boolean> = { ...initial.enabledById };
	for (const id of eventOwnedIds) {
		if (current.enabledById[id] !== undefined) enabledById[id] = current.enabledById[id];
	}
	const merged: ActiveServiceStorageState = {
		ready: true,
		enabledById: Object.freeze(enabledById),
	};
	return sameStorageState(current, merged) ? current : merged;
}

function initialStorageState(
	local: Record<string, unknown>,
	sync: Record<string, unknown>,
): ActiveServiceStorageState {
	const enabledById: Record<string, boolean> = {};
	for (const contract of STORAGE_BACKED_CONTRACTS) {
		const source = contract.area === 'local' ? local : sync;
		enabledById[contract.id] = readStorageBackedContractEnabled(contract, source[contract.key]);
	}
	return { ready: true, enabledById: Object.freeze(enabledById) };
}

function applyStorageChanges(
	current: ActiveServiceStorageState,
	changes: Record<string, chrome.storage.StorageChange>,
	area: string,
	eventOwnedIds: Set<string>,
): ActiveServiceStorageState {
	if (area !== 'local' && area !== 'sync') return current;
	let enabledById: Record<string, boolean> | null = null;
	for (const [key, change] of Object.entries(changes)) {
		const contracts = STORAGE_CONTRACTS_BY_EVENT.get(storageEventKey(area, key));
		if (!contracts) continue;
		for (const contract of contracts) {
			eventOwnedIds.add(contract.id);
			const enabled = readStorageBackedContractEnabled(contract, change.newValue);
			if (current.enabledById[contract.id] === enabled) continue;
			enabledById ??= { ...current.enabledById };
			enabledById[contract.id] = enabled;
		}
	}
	return enabledById ? { ...current, enabledById: Object.freeze(enabledById) } : current;
}

function hasRelevantStorageChange(
	changes: Record<string, chrome.storage.StorageChange>,
	area: string,
): boolean {
	if (area !== 'local' && area !== 'sync') return false;
	return Object.keys(changes).some((key) => STORAGE_CONTRACTS_BY_EVENT.has(storageEventKey(area, key)));
}

function deriveActiveServices(
	storageState: ActiveServiceStorageState,
	userScriptsSnapshot: UserScriptsStorageSnapshot,
): Set<string> {
	const active = new Set<string>();
	if (!storageState.ready || !userScriptsSnapshot.ready) return active;

	for (const [id, enabled] of Object.entries(storageState.enabledById)) {
		if (enabled) active.add(id);
	}
	if (userScriptsSnapshot.globalEnabled) {
		for (const id of USERSCRIPTS_AUTHORITY_IDS) active.add(id);
		for (const script of userScriptsSnapshot.scripts) {
			if (!script.enabled) continue;
			if (script.managedBy === 'packaged-script') {
				const releaseId = script.saatToolId ?? script.id;
				if (RELEASE_SCRIPT_RUNTIME_ID_SET.has(releaseId)) active.add(releaseId);
				continue;
			}
			if (script.managedBy === undefined) active.add(script.id);
			// SaaT-tool activity is owned by generated `saat-registry` contracts.
			// A stale registry row cannot resurrect a catalog-only tool unless that
			// tool is physically release-admitted with an active-service contract.
		}
	}
	return active;
}

interface ActiveServicesContextType {
	activeServices: Set<string>;
	bgToolIds: string[];
}

const ActiveServicesContext = createContext<ActiveServicesContextType | undefined>(undefined);

/**
 * SidePanel status projection. Release admission owns every packaged runtime
 * status source; UserScripts keeps its independent external-store authority.
 * The provider knows no individual plugin id or storage key.
 */
export const ActiveServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [storageState, setStorageState] = useState<ActiveServiceStorageState>(EMPTY_STORAGE_STATE);
	const userScriptsSnapshot = useSyncExternalStore(
		subscribeUserScriptsStorage,
		getUserScriptsStorageSnapshot,
		getUserScriptsStorageSnapshot,
	);

	useEffect(() => {
		let disposed = false;
		const eventOwnedIds = new Set<string>();

		const listener = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (disposed || !hasRelevantStorageChange(changes, area)) return;
			setStorageState((current) => applyStorageChanges(current, changes, area, eventOwnedIds));
		};
		const unsubscribeStorageChanges = subscribeHaloStorageChanges(listener);
		const localRead = STORAGE_KEYS_BY_AREA.local.length > 0
			? chrome.storage.local.get(STORAGE_KEYS_BY_AREA.local)
			: Promise.resolve({});
		const syncRead = STORAGE_KEYS_BY_AREA.sync.length > 0
			? chrome.storage.sync.get(STORAGE_KEYS_BY_AREA.sync)
			: Promise.resolve({});

		void Promise.all([localRead, syncRead]).then(([local, sync]) => {
			if (disposed) return;
			const initial = initialStorageState(local, sync);
			setStorageState((current) =>
				mergeInitialActiveServiceStorageState(current, initial, eventOwnedIds));
		}).catch((error: unknown) => {
			if (disposed) return;
			console.error('[HALO:RuntimeStatus] Initial storage hydration failed', error);
			setStorageState((current) => current.ready ? current : { ...current, ready: true });
		});

		return () => {
			disposed = true;
			unsubscribeStorageChanges();
		};
	}, []);

	const activeServices = useMemo(
		() => deriveActiveServices(storageState, userScriptsSnapshot),
		[storageState, userScriptsSnapshot],
	);
	const bgToolIds = useMemo(() => [...TRUE_BACKGROUND_IDS], []);
	const value = useMemo(
		() => ({ activeServices, bgToolIds }),
		[activeServices, bgToolIds],
	);

	return (
		<ActiveServicesContext.Provider value={value}>
			{children}
		</ActiveServicesContext.Provider>
	);
};

export const useActiveServices = () => {
	const context = useContext(ActiveServicesContext);
	if (!context) throw new Error('useActiveServices must be used within ActiveServicesProvider');
	return context;
};
