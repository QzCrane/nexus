// goal: manages persistence for the restricted domain registry driven by CORS detection
// note: supports data migration from legacy string arrays to structured DomainEntry objects

import type { DomainEntry, DomainSource, RegistryResult } from '@nexus/contracts';
import { findBestHostnameMatch, isDomainEntry, normalizeHostname } from '@nexus/contracts';

const KEY = 'restrictedRegistry';

// rule: per-key serialization queue — concurrent addDomain/removeDomain/markProbed
// previously raced: the second getRegistry() read pre-first-write state and the second
// set() clobbered, silently losing the first mutation. Mirrors the `serialized()` pattern
// in tab-session.ts:26-35 and audio-config.ts.
let operationQueue: Promise<void> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
	const previous = operationQueue;
	const result = previous.then(operation, operation);
	operationQueue = result.then(() => undefined, () => undefined);
	return result;
}

// eff: migrates legacy string[] format to DomainEntry[]
function migrateOldFormat(rawData: unknown): DomainEntry[] {
	if (!Array.isArray(rawData) || !rawData.length) return [];
	// rule: validate each entry via isDomainEntry instead of trusting the head element's
	// shape — the previous `as DomainEntry[]` cast let malformed stored data pass through
	// and then trip fail-closed consumers downstream. Also reject null/array head values
	// (typeof null === 'object', typeof [] === 'object') which previously slipped past.
	if (typeof rawData[0] === 'object' && rawData[0] !== null && !Array.isArray(rawData[0])) {
		return rawData.filter(isDomainEntry);
	}

	// eff: legacy string array conversion with O(n) scan
	// rule: legacy `userRegistry` (deprecated, see user-registry.ts:1) held user-defined
	// RESTRICTED domains, so migrated entries must keep restricted:true — leaving undefined
	// would let `restricted === true` checks at init.ts:152 and isRestricted() misclassify
	// them as not-restricted, silently un-blocking every domain the user previously blocked.
	if (typeof rawData[0] === 'string') {
		const now = Date.now();
		return (rawData as string[]).map((domain, i) => ({
			domain, source: 'user' as DomainSource, probed: false, restricted: true, addedAt: now - i,
		}));
	}
	return [];
}

// post: ensures registry is initialized in local storage
export async function initRegistry(): Promise<DomainEntry[]> {
	const result = await chrome.storage.local.get([KEY, 'userRegistry']);
	const rawData = result[KEY] || result.userRegistry;

	if (rawData) {
		const entries = migrateOldFormat(rawData);
		await chrome.storage.local.set({ [KEY]: entries });
		return entries;
	}

	await chrome.storage.local.set({ [KEY]: [] });
	return [];
}

export async function getRegistry(): Promise<DomainEntry[]> {
	const result = await chrome.storage.local.get(KEY);
	return result[KEY] ? migrateOldFormat(result[KEY]) : initRegistry();
}

export async function isRestricted(domain: string): Promise<boolean> {
	const entries = await getRegistry();
	const entry = findBestHostnameMatch(domain, entries, (item) => item.domain);
	// rule: restricted iff flag is explicitly true; undefined (not probed) and false (safe)
	// must NOT be reported as restricted. The previous `restricted !== false` fail-closed
	// check marked every legacy/setRegistry entry (restricted: undefined) as restricted.
	return entry !== null && entry.restricted === true;
}

// eff: returns domain entry if found, otherwise null
export async function queryDomain(domain: string): Promise<DomainEntry | null> {
	const entries = await getRegistry();
	return findBestHostnameMatch(domain, entries, (item) => item.domain);
}

// eff: internal add-or-update logic — runs inside the caller's serialized block.
// rule: must NOT call serialized() itself — doing so from inside markProbed's
// serialized block would deadlock waiting on the same operationQueue.
async function addOrUpdateDomain(
	normalizedDomain: string,
	source: DomainSource,
	restricted: boolean,
): Promise<RegistryResult> {
	const entries = await getRegistry();
	const existing = entries.find(e => normalizeHostname(e.domain) === normalizedDomain);

	if (existing) {
		existing.source = source;
		existing.probed = true;
		existing.restricted = restricted;
		await chrome.storage.local.set({ [KEY]: entries });
		return { success: true, reason: 'updated', entry: existing };
	}

	const entry: DomainEntry = {
		domain: normalizedDomain, source, probed: true, restricted, addedAt: Date.now(),
	};
	entries.push(entry);
	await chrome.storage.local.set({ [KEY]: entries });
	return { success: true, entry };
}

export async function addDomain(
	domain: string, source: DomainSource, restricted: boolean = true
): Promise<RegistryResult> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return { success: false, reason: 'invalid_domain' };
	return serialized(() => addOrUpdateDomain(normalizedDomain, source, restricted));
}

export async function removeDomain(domain: string): Promise<RegistryResult> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return { success: false, reason: 'invalid_domain' };
	return serialized(async () => {
		const entries = await getRegistry();
		const filtered = entries.filter(e => normalizeHostname(e.domain) !== normalizedDomain);
		if (filtered.length === entries.length) return { success: false, reason: 'not_found' };
		await chrome.storage.local.set({ [KEY]: filtered });
		return { success: true };
	});
}

// eff: record probing results; v3.7 caches both restricted and safe sites
export async function markProbed(domain: string, restricted: boolean): Promise<RegistryResult> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return { success: false, reason: 'invalid_domain' };
	// rule: call addOrUpdateDomain (not addDomain) to avoid nested serialized() deadlock.
	return serialized(() => addOrUpdateDomain(normalizedDomain, 'auto', restricted));
}

// @deprecated: use getRegistry() for full entry data
export async function getDomainList(): Promise<string[]> {
	return (await getRegistry()).map(e => e.domain);
}

// eff: manual override for registry list, usually triggered by user input
export async function setRegistry(domains: string[]): Promise<void> {
	const now = Date.now();
	const entries: DomainEntry[] = [];
	const seen = new Set<string>();
	for (const [index, domain] of domains.entries()) {
		const normalized = normalizeHostname(domain);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		entries.push({
			domain: normalized,
			source: 'user' as DomainSource,
			probed: false,
			// rule: explicit restricted:true — setRegistry replaces the deprecated setUserRegistry
			// (user-registry.ts:1) which held user-defined RESTRICTED domains, and matches the
			// addDomain() default. Omitting produced restricted:undefined entries that the
			// previous fail-closed consumers happened to treat as restricted by accident;
			// making the field explicit keeps the data model correct under the new tri-state checks.
			restricted: true,
			addedAt: now - index,
		});
	}
	await chrome.storage.local.set({ [KEY]: entries });
}
