// goal: provides one serialized owner for every registry read-modify-write operation

import {
	createSiteRouteFingerprint,
	isMediaRouteFingerprint,
	normalizeHostname,
	type DomainEntry,
	type DomainSource,
	type MediaRoute,
	type RegistryAddResult,
	type RegistryQueryResult,
	type RegistryRemoveResult,
	type RegistryResult,
	type RegistrySnapshot,
} from '@nexus/contracts';
import { storage } from './state';

export interface RegistryStoragePort {
	get(): Promise<DomainEntry[]>;
	query(domain: string, fingerprint: string): Promise<DomainEntry | null>;
	add(
		domain: string,
		source: DomainSource,
		route?: MediaRoute,
		fingerprint?: string,
	): Promise<RegistryResult>;
	remove(fingerprint: string): Promise<RegistryResult>;
	markProbed(domain: string, fingerprint: string, route: MediaRoute): Promise<RegistryResult>;
}

function normalizeEntry(value: DomainEntry): DomainEntry | null {
	const domain = normalizeHostname(value.domain);
	if (!domain
		|| (value.source !== 'user' && value.source !== 'auto')
		|| (value.route !== 'direct' && value.route !== 'capture')
		|| !isMediaRouteFingerprint(value.fingerprint)
		|| (value.fingerprint.startsWith('site:')
			&& value.fingerprint !== createSiteRouteFingerprint(domain))
		|| !Number.isSafeInteger(value.updatedAt)
		|| value.updatedAt < 0) {
		return null;
	}
	const entry: DomainEntry = {
		domain,
		fingerprint: value.fingerprint,
		route: value.route,
		source: value.source,
		updatedAt: value.updatedAt,
	};
	return entry;
}

// post: removes malformed/duplicate storage records and emits stable normalized hostnames
export function normalizeRegistryEntries(entries: readonly DomainEntry[]): DomainEntry[] {
	const normalized = new Map<string, DomainEntry>();
	for (const value of entries) {
		const entry = normalizeEntry(value);
		if (!entry) continue;
		const previous = normalized.get(entry.fingerprint);
		if (!previous || entry.updatedAt >= previous.updatedAt) {
			normalized.set(entry.fingerprint, entry);
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

	add(domain: string, source: DomainSource, route: MediaRoute): Promise<RegistryAddResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const before = normalizeRegistryEntries(await this.registry.get());
			const result = await this.registry.add(normalizedDomain, source, route);
			if (!result.success) throw new Error(`Registry add failed: ${result.reason ?? 'unknown'}`);
			const snapshot = await this.readSnapshot();
			const entry = result.entry
				? snapshot.entries.find((candidate) => candidate.fingerprint === result.entry?.fingerprint)
				: undefined;
			if (!entry) throw new Error('Registry add did not persist an entry');
			return {
				...snapshot,
				entry,
				created: !before.some((candidate) => candidate.fingerprint === entry.fingerprint),
			};
		});
	}

	remove(fingerprint: string): Promise<RegistryRemoveResult> {
		return this.serialize(async () => {
			const result = await this.registry.remove(fingerprint);
			const snapshot = await this.readSnapshot();
			return { ...snapshot, removed: result.success };
		});
	}

	query(domain: string, fingerprint: string): Promise<RegistryQueryResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const entry = await this.registry.query(normalizedDomain, fingerprint);
			return { entry: entry ? normalizeEntry(entry) : null };
		});
	}

	markProbed(
		domain: string,
		fingerprint: string,
		route: MediaRoute,
	): Promise<RegistryAddResult> {
		return this.serialize(async () => {
			const normalizedDomain = normalizeHostname(domain);
			if (!normalizedDomain) throw new Error('Invalid registry domain');
			const before = normalizeRegistryEntries(await this.registry.get());
			const result = await this.registry.markProbed(normalizedDomain, fingerprint, route);
			if (!result.success) throw new Error(`Registry probe update failed: ${result.reason ?? 'unknown'}`);
			const snapshot = await this.readSnapshot();
			const entry = snapshot.entries.find((candidate) => candidate.fingerprint === fingerprint);
			if (!entry) throw new Error('Registry probe update did not persist an entry');
			return {
				...snapshot,
				entry,
				created: !before.some((candidate) => candidate.fingerprint === fingerprint),
			};
		});
	}
}

export const registryRepository = new RegistryRepository(storage.registry);
