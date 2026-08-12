// goal: pure persistence schema shared by HALO UserScripts UI and worker registry
// inv: malformed persisted rows are rejected before any runtime registration decision

import type { ScriptType } from '../../kernel/registry/taxonomy';
import type { UserScript, UserScriptManagedBy, UserScriptRunAt } from './types';

export type UserScriptsSnapshotScript = Omit<Readonly<UserScript>, 'matches' | 'excludeMatches'> & {
	readonly matches: readonly string[];
	readonly excludeMatches?: readonly string[];
};
export interface UserScriptsStorageSnapshot {
	readonly failed: boolean;
	readonly globalEnabled: boolean;
	readonly scripts: readonly UserScriptsSnapshotScript[];
}

const SCRIPT_TYPES: ReadonlySet<ScriptType> = new Set(['javascript', 'typescript', 'css']);
const RUN_AT_VALUES: ReadonlySet<UserScriptRunAt> = new Set(['document_start', 'document_end', 'document_idle']);
const WORLD_VALUES = new Set(['ISOLATED', 'MAIN', 'USER_SCRIPT']);
const MANAGED_BY_VALUES: ReadonlySet<UserScriptManagedBy> = new Set(['packaged-script', 'saat-tool']);
const KNOWN_FIELDS = new Set([
	'id', 'name', 'description', 'code', 'enabled', 'type', 'matches', 'excludeMatches', 'runAt',
	'world', 'filePath', 'order', 'version', 'author', 'homepage', 'updateUrl', 'category', 'runCount',
	'lastRun', 'createdAt', 'updatedAt', 'saatToolId', 'managedBy', 'moduleBuiltIn',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EMPTY = Object.freeze([]) as readonly UserScriptsSnapshotScript[];
const FAILED: UserScriptsStorageSnapshot = Object.freeze({ failed: true, globalEnabled: false, scripts: EMPTY });

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}
function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function cloneExtra(value: unknown, depth = 0): unknown | null {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'object' || depth >= 8) return null;
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		for (const item of value) {
			const cloned = cloneExtra(item, depth + 1);
			if (cloned === null && item !== null) return null;
			result.push(cloned);
		}
		return Object.freeze(result);
	}
	const source = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(source)) {
		if (FORBIDDEN_KEYS.has(key)) return null;
		const cloned = cloneExtra(item, depth + 1);
		if (cloned === null && item !== null) return null;
		result[key] = cloned;
	}
	return Object.freeze(result);
}

function normalizeScript(value: unknown): UserScriptsSnapshotScript | null {
	if (!isRecord(value)
		|| typeof value.id !== 'string'
		|| typeof value.name !== 'string'
		|| typeof value.description !== 'string'
		|| typeof value.code !== 'string'
		|| typeof value.enabled !== 'boolean'
		|| typeof value.type !== 'string' || !SCRIPT_TYPES.has(value.type as ScriptType)
		|| !stringArray(value.matches) || value.matches.length === 0 || value.matches.some((item) => !item.trim())
		|| typeof value.runAt !== 'string' || !RUN_AT_VALUES.has(value.runAt as UserScriptRunAt)
		|| !finite(value.order) || !finite(value.runCount) || !finite(value.createdAt) || !finite(value.updatedAt)
		|| !optionalString(value.filePath) || !optionalString(value.version) || !optionalString(value.author)
		|| !optionalString(value.homepage) || !optionalString(value.updateUrl) || !optionalString(value.category)
		|| !optionalString(value.saatToolId)
		|| (value.managedBy !== undefined && (typeof value.managedBy !== 'string' || !MANAGED_BY_VALUES.has(value.managedBy as UserScriptManagedBy)))
		|| (value.moduleBuiltIn !== undefined && typeof value.moduleBuiltIn !== 'boolean')
		|| (value.excludeMatches !== undefined && (!stringArray(value.excludeMatches) || value.excludeMatches.some((item) => !item.trim())))
		|| (value.world !== undefined && (typeof value.world !== 'string' || !WORLD_VALUES.has(value.world)))
		|| (value.lastRun !== undefined && !finite(value.lastRun))) return null;

	const extra: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (KNOWN_FIELDS.has(key)) continue;
		if (FORBIDDEN_KEYS.has(key)) return null;
		const cloned = cloneExtra(item);
		if (cloned === null && item !== null) return null;
		extra[key] = cloned;
	}
	return Object.freeze({
		...extra,
		...value,
		matches: Object.freeze([...value.matches]),
		...(value.excludeMatches === undefined ? {} : { excludeMatches: Object.freeze([...value.excludeMatches]) }),
	}) as UserScriptsSnapshotScript;
}

export function parseUserScriptsStorageValue(value: unknown): UserScriptsStorageSnapshot {
	if (value === undefined) return Object.freeze({ failed: false, globalEnabled: true, scripts: EMPTY });
	if (!isRecord(value) || !Array.isArray(value.scripts)
		|| (value.globalEnabled !== undefined && typeof value.globalEnabled !== 'boolean')) return FAILED;
	const scripts: UserScriptsSnapshotScript[] = [];
	for (const raw of value.scripts) {
		const script = normalizeScript(raw);
		if (!script) return FAILED;
		scripts.push(script);
	}
	return Object.freeze({
		failed: false,
		globalEnabled: value.globalEnabled ?? true,
		scripts: scripts.length === 0 ? EMPTY : Object.freeze(scripts),
	});
}
