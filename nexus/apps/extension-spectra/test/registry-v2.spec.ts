import { describe, expect, test } from 'bun:test';
import {
	findBestHostnameMatch,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	normalizeHostname,
	rpcSuccess,
	type DomainEntry,
	type DomainSource,
	type RegistryResult,
} from '@nexus/contracts';
import {
	RegistryRepository,
	type RegistryStoragePort,
} from '../src/background/registry-repository';
import {
	HotkeyTargetRepository,
	type HotkeyTargetStoragePort,
} from '../src/background/hotkey-target-repository';
import { registerRegistryHandlers } from '../src/background/handlers/registry';

function createRegistryStorage(initial: DomainEntry[] = []): RegistryStoragePort & { entries: DomainEntry[] } {
	let addedAt = 1_700_000_000_000;
	const storage = {
		entries: structuredClone(initial),
		async get() {
			return structuredClone(storage.entries);
		},
		async query(domain: string) {
			return findBestHostnameMatch(domain, storage.entries, (entry) => entry.domain);
		},
		async add(domain: string, source: DomainSource, restricted = true): Promise<RegistryResult> {
			const normalized = normalizeHostname(domain);
			if (!normalized) return { success: false, reason: 'invalid_domain' };
			// Deliberately split read/write across an await so a missing owner queue loses updates.
			const next = structuredClone(storage.entries);
			await Promise.resolve();
			const existing = next.find((entry) => normalizeHostname(entry.domain) === normalized);
			if (existing) {
				existing.source = source;
				existing.probed = true;
				existing.restricted = restricted;
				storage.entries = next;
				return { success: true, reason: 'updated', entry: existing };
			}
			const entry: DomainEntry = {
				domain: normalized,
				source,
				probed: true,
				restricted,
				addedAt: addedAt++,
			};
			next.push(entry);
			storage.entries = next;
			return { success: true, entry };
		},
		async remove(domain: string): Promise<RegistryResult> {
			const normalized = normalizeHostname(domain);
			if (!normalized) return { success: false, reason: 'invalid_domain' };
			const next = storage.entries.filter((entry) => normalizeHostname(entry.domain) !== normalized);
			if (next.length === storage.entries.length) return { success: false, reason: 'not_found' };
			storage.entries = next;
			return { success: true };
		},
		async markProbed(domain: string, restricted: boolean): Promise<RegistryResult> {
			return storage.add(domain, 'auto', restricted);
		},
	};
	return storage;
}

describe('SPECTRA v2 registry contracts', () => {
	test('strictly validates registry and hotkey target payloads', () => {
		const base = { protocolVersion: 2, requestId: 'registry-request' };
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.add',
			payload: { domain: 'BÜCHER.example.', restricted: true },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.add',
			payload: { domain: 'example.com', restricted: true, source: 'auto' },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.mark-probed',
			payload: { domain: 'not a domain', restricted: true },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.hotkey-target.set',
			payload: { tabId: 7 },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.hotkey-target.set',
			payload: { tabId: 0 },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.hotkey-target.set',
			payload: { tabId: null },
		})).toBe(true);
	});

	test('rejects non-canonical registry responses and unknown fields', () => {
		const entry: DomainEntry = {
			domain: 'example.com',
			source: 'user',
			probed: true,
			restricted: true,
			addedAt: 1,
		};
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({ entries: [entry] }))).toBe(true);
		expect(isSpectraResponse('spectra.registry.add', rpcSuccess({
			entries: [{ ...entry, source: 'auto' }],
			entry: { ...entry, source: 'auto' },
			created: true,
		}))).toBe(false);
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({
			entries: [{ ...entry, domain: 'EXAMPLE.com' }],
		}))).toBe(false);
		expect(isSpectraResponse('spectra.registry.query', rpcSuccess({ entry: null }))).toBe(true);
		expect(isSpectraResponse('spectra.registry.remove', rpcSuccess({
			entries: [],
			removed: true,
			extra: true,
		}))).toBe(false);
	});
});

describe('background-owned registry repository', () => {
	test('normalizes IDNA/trailing dots and does not lose concurrent writes', async () => {
		const storage = createRegistryStorage();
		const repository = new RegistryRepository(storage);
		const [first, second] = await Promise.all([
			repository.add('BÜCHER.Example.', 'user', true),
			repository.add('media.example.com', 'user', false),
		]);

		expect(first.entry.domain).toBe('xn--bcher-kva.example');
		expect(second.entry.domain).toBe('media.example.com');
		expect((await repository.getSnapshot()).entries.map((entry) => entry.domain)).toEqual([
			'xn--bcher-kva.example',
			'media.example.com',
		]);
	});

	test('serializes auto probe updates with user mutations and returns the newest snapshot', async () => {
		const storage = createRegistryStorage();
		const repository = new RegistryRepository(storage);
		await Promise.all([
			repository.markProbed('video.example.com', true),
			repository.add('music.example.com', 'user', false),
		]);
		const queried = await repository.query('cdn.video.example.com');
		expect(queried.entry).toMatchObject({
			domain: 'video.example.com',
			source: 'auto',
			restricted: true,
		});
		const removed = await repository.remove('MUSIC.example.com.');
		expect(removed.removed).toBe(true);
		expect(removed.entries.map((entry) => entry.domain)).toEqual(['video.example.com']);
	});

	test('v2 user adds are persisted with a fixed user source', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const listeners: Array<(
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response: unknown) => void,
		) => boolean | undefined> = [];
		const localState: Record<string, unknown> = {
			restrictedRegistry: [{
				domain: 'xn--bcher-kva.example',
				source: 'auto',
				probed: true,
				restricted: true,
				addedAt: 1,
			}],
		};
		const sessionState: Record<string, unknown> = {};
		const readArea = (state: Record<string, unknown>, keys: string | string[]) => {
			const selected = Array.isArray(keys) ? keys : [keys];
			return Object.fromEntries(selected.map((key) => [key, state[key]]));
		};
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) },
				},
				storage: {
					local: {
						get: async (keys: string | string[]) => readArea(localState, keys),
						set: async (values: Record<string, unknown>) => Object.assign(localState, values),
					},
					session: {
						get: async (keys: string | string[]) => readArea(sessionState, keys),
						set: async (values: Record<string, unknown>) => Object.assign(sessionState, values),
						remove: async (key: string) => { delete sessionState[key]; },
					},
				},
				tabs: { get: async (tabId: number) => ({ id: tabId }) },
			},
		});

		try {
			registerRegistryHandlers();
			const listener = listeners[0];
			if (!listener) throw new Error('Registry v2 listener was not registered');
			const response = await new Promise<unknown>((resolve, reject) => {
				const handled = listener({
					protocolVersion: 2,
					requestId: 'user-add',
					type: 'spectra.registry.add',
					payload: { domain: 'BÜCHER.Example.', restricted: false },
				}, { id: 'spectra-test' }, resolve);
				if (!handled) reject(new Error('Registry v2 request was not handled'));
			});
			expect(isSpectraResponse('spectra.registry.add', response)).toBe(true);
			expect(localState.restrictedRegistry).toEqual([expect.objectContaining({
				domain: 'xn--bcher-kva.example',
				source: 'user',
				restricted: false,
			})]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});

describe('background-owned hotkey target repository', () => {
	test('gets, sets, and clears the target when its tab closes', async () => {
		let stored: unknown;
		const availableTabs = new Set([7]);
		const targetStorage: HotkeyTargetStoragePort = {
			async get() { return stored; },
			async set(tabId) { stored = tabId; },
			async remove() { stored = undefined; },
		};
		const repository = new HotkeyTargetRepository(targetStorage, {
			async get(tabId) {
				if (!availableTabs.has(tabId)) throw new Error('No tab');
				return { id: tabId };
			},
		});

		expect(await repository.set(7)).toEqual({ tabId: 7 });
		expect(await repository.get()).toEqual({ tabId: 7 });
		await repository.clearIfMatches(8);
		expect(await repository.get()).toEqual({ tabId: 7 });
		await repository.clearIfMatches(7);
		expect(await repository.get()).toEqual({ tabId: null });
		await expect(repository.set(0)).rejects.toThrow('positive integer');
	});

	test('drops stale session state after a service worker restart', async () => {
		let stored: unknown = 99;
		const repository = new HotkeyTargetRepository({
			async get() { return stored; },
			async set(tabId) { stored = tabId; },
			async remove() { stored = undefined; },
		}, {
			async get() { throw new Error('No tab'); },
		});
		expect(await repository.get()).toEqual({ tabId: null });
		expect(stored).toBeUndefined();
	});
});
