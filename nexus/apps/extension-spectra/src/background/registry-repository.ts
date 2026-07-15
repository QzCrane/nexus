// goal: provides one serialized owner for every registry read-modify-write operation

import {
	normalizeHostname,
	type DomainEntry,
	type DomainSource,
	type RegistryAddResult,
	type RegistryQueryResult,
	type RegistryRemoveResult,
	type RegistryResult,
	type RegistrySnapshot,
} from '@nexus/contracts';
import { storage } from './state';

export interface RegistryStoragePort {
	get(): Promise<DomainEntry[]>;
	query(domain: string): Promise<DomainEntry | null>;
	add(domain: string, source: DomainSource, restricted?: boolean): Promise<RegistryResult>;
	remove(domain: string): Promise<RegistryResult>;
	markProbed(domain: string, restricted: boolean): Promise<RegistryResult>;
}

function normalizeEntry(value: DomainEntry): DomainEntry | null {
	const domain = normalizeHostname(value.domain);
	if (!domain || (value.source !== 'user' && value.source !== 'auto') || typeof value.probed !== 'boolean') {
		return null;
	}
	const entry: DomainEntry = {
		domain,
		source: value.source,
		probed: value.probed,
	};
	if (typeof value.restricted === 'boolean') entry.restricted = value.restricted;
	if (typeof value.addedAt === 'number' && Number.isSafeInteger(value.addedAt) && value.addedAt >= 0) {
		entry.addedAt = value.addedAt;
	}
	return entry;
}

// post: removes malformed/duplicate storage records and emits stable normalized hostnames
export function normalizeRegistryEntries(entries: readonly DomainEntry[]): DomainEntry[] {
	const normalized = new Map<string, DomainEntry>();
	for (const value of entries) {
		const entry = normalizeEntry(value);
		if (!entry) continue;
		const previous = normalized.get(entry.domain);
		if (!previous || (entry.addedAt ?? 0) >= (previous.addedAt ?? 0)) {
			normalized.set(entry.domain, entry);
		}
	}
	return [...normalized.values()];
}

export class RegistryRepository {
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly registry: RegistryStoragePort) {}

	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation, operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async readSnapshot(): Promise<RegistrySnapshot> {
		return { entries: normalizeRegistryEntries(await this.registry.get()) };
	}

	getSnapshot(): Promise<RegistrySnapshot> {
		return this.serialize(() => this.readSnapshot());
	}

	add(domain: string, source: DomainSource, restricted: boolean): Promise<RegistryAddResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const before = normalizeRegistryEntries(await this.registry.get());
			const result = await this.registry.add(normalizedDomain, source, restricted);
			if (!result.success) throw new Error(`Registry add failed: ${result.reason ?? 'unknown'}`);
			const snapshot = await this.readSnapshot();
			const entry = snapshot.entries.find((candidate) => candidate.domain === normalizedDomain);
			if (!entry) throw new Error('Registry add did not persist an entry');
			return {
				...snapshot,
				entry,
				created: !before.some((candidate) => candidate.domain === normalizedDomain),
			};
		});
	}

	remove(domain: string): Promise<RegistryRemoveResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const result = await this.registry.remove(normalizedDomain);
			const snapshot = await this.readSnapshot();
			return { ...snapshot, removed: result.success };
		});
	}

	query(domain: string): Promise<RegistryQueryResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const entry = await this.registry.query(normalizedDomain);
			return { entry: entry ? normalizeEntry(entry) : null };
		});
	}

	markProbed(domain: string, restricted: boolean): Promise<RegistryAddResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const before = normalizeRegistryEntries(await this.registry.get());
			const result = await this.registry.markProbed(normalizedDomain, restricted);
			if (!result.success) throw new Error(`Registry probe update failed: ${result.reason ?? 'unknown'}`);
			const snapshot = await this.readSnapshot();
			const entry = snapshot.entries.find((candidate) => candidate.domain === normalizedDomain);
			if (!entry) throw new Error('Registry probe update did not persist an entry');
			return {
				...snapshot,
				entry,
				created: !before.some((candidate) => candidate.domain === normalizedDomain),
			};
		});
	}
}

export const registryRepository = new RegistryRepository(storage.registry);
