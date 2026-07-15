// goal: legacy persistence for user-defined restricted domains using 'userRegistry' key
// note: @deprecated in favor of restricted-registry.ts structured storage

import { hostnameMatchesRule, normalizeHostname } from '@nexus/contracts';

const KEY = 'userRegistry';

export async function getUserRegistry(): Promise<string[]> {
	const result = await chrome.storage.local.get(KEY);
	return result[KEY] || [];
}

export async function addToUserRegistry(domain: string): Promise<boolean> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return false;
	const registry = await getUserRegistry();
	const exists = registry.some(d => hostnameMatchesRule(normalizedDomain, d));
	if (exists) return false;
	registry.push(normalizedDomain);
	await chrome.storage.local.set({ [KEY]: registry });
	return true;
}

export async function removeFromUserRegistry(domain: string): Promise<boolean> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return false;
	const registry = await getUserRegistry();
	const filtered = registry.filter(d => normalizeHostname(d) !== normalizedDomain);
	if (filtered.length === registry.length) return false;
	await chrome.storage.local.set({ [KEY]: filtered });
	return true;
}

export async function setUserRegistry(registry: string[]): Promise<void> {
	const normalized = Array.from(new Set(registry.map(normalizeHostname).filter((domain): domain is string => !!domain)));
	await chrome.storage.local.set({ [KEY]: normalized });
}
