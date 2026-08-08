// goal: one reactive authority for the halo_userscripts storage key
// inv: every SidePanel consumer shares one Chrome read/listener lifecycle

import type { ScriptType } from '../../kernel/registry/taxonomy';
import { STORAGE_KEY } from './storage';
import type { UserScript, UserScriptRunAt, UserScriptState } from './types';

export interface UserScriptsStorageSnapshot {
	ready: boolean;
	failed: boolean;
	globalEnabled: boolean;
	readonly scripts: readonly Readonly<UserScript>[];
	readonly toolbarConfig?: Readonly<NonNullable<UserScriptState['toolbarConfig']>>;
}

const SCRIPT_TYPES: ReadonlySet<ScriptType> = new Set(['javascript', 'typescript', 'css']);
const RUN_AT_VALUES: ReadonlySet<UserScriptRunAt> = new Set([
	'document_start',
	'document_end',
	'document_idle',
]);
const WORLD_VALUES = new Set(['ISOLATED', 'MAIN', 'USER_SCRIPT']);
const EMPTY_SCRIPTS = Object.freeze([]) as readonly Readonly<UserScript>[];
const EMPTY_SNAPSHOT: UserScriptsStorageSnapshot = Object.freeze({
	ready: false,
	failed: false,
	globalEnabled: false,
	scripts: EMPTY_SCRIPTS,
});
const FAILED_SNAPSHOT: UserScriptsStorageSnapshot = Object.freeze({
	ready: true,
	failed: true,
	globalEnabled: false,
	scripts: EMPTY_SCRIPTS,
});

let snapshot = EMPTY_SNAPSHOT;
let started = false;
let lifecycleEpoch = 0;
let eventRevision = 0;
let readRevision = 0;
const subscribers = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function normalizeScript(value: unknown): Readonly<UserScript> | null {
	if (!isRecord(value)
		|| typeof value.id !== 'string'
		|| typeof value.name !== 'string'
		|| typeof value.description !== 'string'
		|| typeof value.code !== 'string'
		|| typeof value.enabled !== 'boolean'
		|| typeof value.type !== 'string'
		|| !SCRIPT_TYPES.has(value.type as ScriptType)
		|| !isStringArray(value.matches)
		|| typeof value.runAt !== 'string'
		|| !RUN_AT_VALUES.has(value.runAt as UserScriptRunAt)
		|| !isFiniteNumber(value.order)
		|| !isFiniteNumber(value.runCount)
		|| !isFiniteNumber(value.createdAt)
		|| !isFiniteNumber(value.updatedAt)
		|| !optionalString(value.filePath)
		|| !optionalString(value.version)
		|| !optionalString(value.author)
		|| !optionalString(value.homepage)
		|| !optionalString(value.updateUrl)
		|| !optionalString(value.category)
		|| !optionalString(value.saatToolId)
		|| (value.excludeMatches !== undefined && !isStringArray(value.excludeMatches))
		|| (value.world !== undefined && (
			typeof value.world !== 'string' || !WORLD_VALUES.has(value.world)
		))
		|| (value.lastRun !== undefined && !isFiniteNumber(value.lastRun))) return null;

	const matches = [...value.matches];
	Object.freeze(matches);
	const excludeMatches = value.excludeMatches === undefined
		? undefined
		: [...value.excludeMatches];
	if (excludeMatches) Object.freeze(excludeMatches);
	return Object.freeze({
		id: value.id,
		name: value.name,
		description: value.description,
		code: value.code,
		enabled: value.enabled,
		type: value.type as ScriptType,
		matches,
		...(excludeMatches === undefined ? {} : { excludeMatches }),
		runAt: value.runAt as UserScriptRunAt,
		...(value.world === undefined ? {} : { world: value.world as UserScript['world'] }),
		...(value.filePath === undefined ? {} : { filePath: value.filePath }),
		order: value.order,
		...(value.version === undefined ? {} : { version: value.version }),
		...(value.author === undefined ? {} : { author: value.author }),
		...(value.homepage === undefined ? {} : { homepage: value.homepage }),
		...(value.updateUrl === undefined ? {} : { updateUrl: value.updateUrl }),
		...(value.category === undefined ? {} : { category: value.category }),
		runCount: value.runCount,
		...(value.lastRun === undefined ? {} : { lastRun: value.lastRun }),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		...(value.saatToolId === undefined ? {} : { saatToolId: value.saatToolId }),
	});
}

function normalizeToolbarConfig(
	value: unknown,
): Readonly<NonNullable<UserScriptState['toolbarConfig']>> | undefined {
	if (!isRecord(value)
		|| !isStringArray(value.order)
		|| typeof value.hideOnOverflow !== 'boolean') return undefined;
	const order = [...value.order];
	Object.freeze(order);
	return Object.freeze({ order, hideOnOverflow: value.hideOnOverflow });
}

export function parseUserScriptsStorageValue(value: unknown): UserScriptsStorageSnapshot {
	// Missing key is the only state that receives the historical default-on value.
	if (value === undefined) {
		return Object.freeze({
			ready: true,
			failed: false,
			globalEnabled: true,
			scripts: EMPTY_SCRIPTS,
		});
	}
	if (!isRecord(value)
		|| !Array.isArray(value.scripts)
		|| (value.globalEnabled !== undefined && typeof value.globalEnabled !== 'boolean')) {
		return FAILED_SNAPSHOT;
	}
	const scripts = value.scripts
		.map(normalizeScript)
		.filter((entry): entry is Readonly<UserScript> => entry !== null);
	const toolbarConfig = normalizeToolbarConfig(value.toolbarConfig);
	return Object.freeze({
		ready: true,
		failed: false,
		globalEnabled: value.globalEnabled ?? true,
		scripts: scripts.length === 0 ? EMPTY_SCRIPTS : Object.freeze(scripts),
		...(toolbarConfig ? { toolbarConfig } : {}),
	});
}

function publish(next: UserScriptsStorageSnapshot): void {
	if (snapshot === next) return;
	snapshot = next;
	for (const subscriber of subscribers) subscriber();
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
		publish(FAILED_SNAPSHOT);
	}
}

function start(): void {
	if (started) return;
	started = true;
	const epoch = ++lifecycleEpoch;
	chrome.storage.onChanged.addListener(onStorageChanged);
	const request = ++readRevision;
	void readCurrent(epoch, request, eventRevision);
}

function stop(): void {
	if (!started) return;
	started = false;
	lifecycleEpoch += 1;
	readRevision += 1;
	chrome.storage.onChanged.removeListener(onStorageChanged);
	snapshot = EMPTY_SNAPSHOT;
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
		snapshot = EMPTY_SNAPSHOT;
	},
};
