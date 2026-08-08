// goal: one reactive authority for the halo_userscripts storage key
// inv: every SidePanel consumer shares one lossless, fail-closed persistence snapshot

import { subscribeHaloStorageChanges } from '../../kernel/core/storage-change-bus';
import type { ScriptType } from '../../kernel/registry/taxonomy';
import { STORAGE_KEY } from './storage';
import type {
	UserScript,
	UserScriptManagedBy,
	UserScriptRunAt,
} from './types';

export type UserScriptsSnapshotScript = Omit<Readonly<UserScript>, 'matches' | 'excludeMatches'> & {
	readonly matches: readonly string[];
	readonly excludeMatches?: readonly string[];
};
export type UserScriptsToolbarAction = 'add' | 'export' | 'import';
export interface UserScriptsToolbarSnapshot {
	readonly order: readonly UserScriptsToolbarAction[];
	readonly hideOnOverflow: boolean;
}
export interface UserScriptsStorageSnapshot {
	readonly ready: boolean;
	readonly failed: boolean;
	readonly globalEnabled: boolean;
	readonly scripts: readonly UserScriptsSnapshotScript[];
	readonly toolbarConfig?: UserScriptsToolbarSnapshot;
}

const SCRIPT_TYPES: ReadonlySet<ScriptType> = new Set(['javascript', 'typescript', 'css']);
const RUN_AT_VALUES: ReadonlySet<UserScriptRunAt> = new Set([
	'document_start',
	'document_end',
	'document_idle',
]);
const WORLD_VALUES = new Set(['ISOLATED', 'MAIN', 'USER_SCRIPT']);
const MANAGED_BY_VALUES: ReadonlySet<UserScriptManagedBy> = new Set(['packaged-script', 'saat-tool']);
const TOOLBAR_ACTIONS: readonly UserScriptsToolbarAction[] = ['add', 'export', 'import'];
const TOOLBAR_ACTION_SET = new Set<string>(TOOLBAR_ACTIONS);
const KNOWN_SCRIPT_FIELDS = new Set([
	'id', 'name', 'description', 'code', 'enabled', 'type', 'matches', 'excludeMatches',
	'runAt', 'world', 'filePath', 'order', 'version', 'author', 'homepage', 'updateUrl',
	'category', 'runCount', 'lastRun', 'createdAt', 'updatedAt', 'saatToolId', 'managedBy',
	'moduleBuiltIn',
]);
const FORBIDDEN_EXTENSION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_EXTENSION_METADATA_DEPTH = 8;
const EMPTY_SCRIPTS = Object.freeze([]) as readonly UserScriptsSnapshotScript[];
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
let unsubscribeStorageChanges: (() => void) | null = null;
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

function isNonEmptyStringArray(value: unknown): value is string[] {
	return isStringArray(value)
		&& value.length > 0
		&& value.every((entry) => entry.trim().length > 0);
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function cloneExtensionMetadata(
	value: unknown,
	depth = 0,
	seen = new WeakSet<object>(),
): unknown | null {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (depth >= MAX_EXTENSION_METADATA_DEPTH || typeof value !== 'object') return null;
	if (seen.has(value)) return null;
	seen.add(value);

	if (Array.isArray(value)) {
		const result: unknown[] = [];
		for (const entry of value) {
			const cloned = cloneExtensionMetadata(entry, depth + 1, seen);
			if (cloned === null && entry !== null) return null;
			result.push(cloned);
		}
		seen.delete(value);
		return Object.freeze(result);
	}

	const source = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(source)) {
		if (FORBIDDEN_EXTENSION_KEYS.has(key)) return null;
		const cloned = cloneExtensionMetadata(entry, depth + 1, seen);
		if (cloned === null && entry !== null) return null;
		result[key] = cloned;
	}
	seen.delete(value);
	return Object.freeze(result);
}

function extensionFields(value: Record<string, unknown>): Record<string, unknown> | null {
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (KNOWN_SCRIPT_FIELDS.has(key)) continue;
		if (FORBIDDEN_EXTENSION_KEYS.has(key)) return null;
		const cloned = cloneExtensionMetadata(entry);
		if (cloned === null && entry !== null) return null;
		result[key] = cloned;
	}
	return result;
}

function normalizeScript(value: unknown): UserScriptsSnapshotScript | null {
	if (!isRecord(value)
		|| typeof value.id !== 'string'
		|| typeof value.name !== 'string'
		|| typeof value.description !== 'string'
		|| typeof value.code !== 'string'
		|| typeof value.enabled !== 'boolean'
		|| typeof value.type !== 'string'
		|| !SCRIPT_TYPES.has(value.type as ScriptType)
		|| !isNonEmptyStringArray(value.matches)
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
		|| (value.managedBy !== undefined && (
			typeof value.managedBy !== 'string'
			|| !MANAGED_BY_VALUES.has(value.managedBy as UserScriptManagedBy)
		))
		|| (value.moduleBuiltIn !== undefined && typeof value.moduleBuiltIn !== 'boolean')
		|| (value.excludeMatches !== undefined && (
			!isStringArray(value.excludeMatches)
			|| value.excludeMatches.some((entry) => entry.trim().length === 0)
		))
		|| (value.world !== undefined && (
			typeof value.world !== 'string' || !WORLD_VALUES.has(value.world)
		))
		|| (value.lastRun !== undefined && !isFiniteNumber(value.lastRun))) return null;

	const extra = extensionFields(value);
	if (extra === null) return null;
	const matches = Object.freeze([...value.matches]);
	const excludeMatches = value.excludeMatches === undefined
		? undefined
		: Object.freeze([...value.excludeMatches]);
	return Object.freeze({
		...extra,
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
		...(value.managedBy === undefined
			? {}
			: { managedBy: value.managedBy as UserScriptManagedBy }),
		...(value.moduleBuiltIn === undefined ? {} : { moduleBuiltIn: value.moduleBuiltIn }),
	}) as UserScriptsSnapshotScript;
}

function normalizeToolbarConfig(value: unknown): UserScriptsToolbarSnapshot | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)
		|| !isStringArray(value.order)
		|| typeof value.hideOnOverflow !== 'boolean') return null;
	if (value.order.length !== TOOLBAR_ACTIONS.length
		|| new Set(value.order).size !== TOOLBAR_ACTIONS.length
		|| value.order.some((action) => !TOOLBAR_ACTION_SET.has(action))) return null;
	return Object.freeze({
		order: Object.freeze([...value.order]) as readonly UserScriptsToolbarAction[],
		hideOnOverflow: value.hideOnOverflow,
	});
}

export function parseUserScriptsStorageValue(value: unknown): UserScriptsStorageSnapshot {
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

	const scripts: UserScriptsSnapshotScript[] = [];
	for (const rawScript of value.scripts) {
		const normalized = normalizeScript(rawScript);
		if (normalized === null) return FAILED_SNAPSHOT;
		scripts.push(normalized);
	}
	const toolbarConfig = normalizeToolbarConfig(value.toolbarConfig);
	if (toolbarConfig === null) return FAILED_SNAPSHOT;
	return Object.freeze({
		ready: true,
		failed: false,
		globalEnabled: value.globalEnabled ?? true,
		scripts: scripts.length === 0 ? EMPTY_SCRIPTS : Object.freeze(scripts),
		...(toolbarConfig === undefined ? {} : { toolbarConfig }),
	});
}

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
		publish(FAILED_SNAPSHOT);
	}
}

function start(): void {
	if (started) return;
	started = true;
	const epoch = ++lifecycleEpoch;
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
