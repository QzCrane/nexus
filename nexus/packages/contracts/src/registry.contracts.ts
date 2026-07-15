// goal: defines contracts for the restricted domain registry (CORS detection & user manual entries)

import { normalizeHostname } from './domain.contracts.js';

// auto-detected or user-added
export type DomainSource = 'user' | 'auto';

export interface DomainEntry {
	// domain: e.g. douyin.com
	domain: string;
	source: DomainSource;
	// probed: whether CORS detection has been performed
	probed: boolean;
	// restricted: true=CORS blocked, false=safe, undefined=not probed
	restricted?: boolean;
	// addedAt: timestamp for sorting/cleanup
	addedAt?: number;
}

// RegistryStorage: storage format handled by kernel
export type RegistryStorage = DomainEntry[] | string[];

export interface RegistryResult {
	success: boolean;
	reason?: string;
	entry?: DomainEntry;
}

export interface RegistrySnapshot {
	entries: DomainEntry[];
}

export interface RegistryAddResult extends RegistrySnapshot {
	entry: DomainEntry;
	created: boolean;
}

export interface RegistryRemoveResult extends RegistrySnapshot {
	removed: boolean;
}

export interface RegistryQueryResult {
	entry: DomainEntry | null;
}

export interface HotkeyTargetState {
	tabId: number | null;
}

const DOMAIN_ENTRY_KEYS = new Set(['domain', 'source', 'probed', 'restricted', 'addedAt']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

// post: accepts only normalized, serializable entries safe to cross an extension boundary
export function isDomainEntry(value: unknown): value is DomainEntry {
	if (!isRecord(value) || !hasOnlyKeys(value, DOMAIN_ENTRY_KEYS)) return false;
	return typeof value.domain === 'string'
		&& normalizeHostname(value.domain) === value.domain
		&& (value.source === 'user' || value.source === 'auto')
		&& typeof value.probed === 'boolean'
		&& (value.restricted === undefined || typeof value.restricted === 'boolean')
		&& (value.addedAt === undefined || (
			typeof value.addedAt === 'number'
			&& Number.isSafeInteger(value.addedAt)
			&& value.addedAt >= 0
		));
}

export function isRegistryEntries(value: unknown): value is DomainEntry[] {
	return Array.isArray(value)
		&& value.length <= 10_000
		&& value.every(isDomainEntry)
		&& new Set(value.map((entry) => entry.domain)).size === value.length;
}
