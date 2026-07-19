import { describe, expect, test } from 'bun:test';
import {
	createSiteRouteFingerprint,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	normalizeHostname,
	rpcSuccess,
	type DomainEntry,
	type DomainSource,
	type MediaRoute,
	type RegistryResult,
} from '@nexus/contracts';
import {
	RegistryRepository,
	normalizeRegistryEntries,
	type RegistryStoragePort,
} from '../src/background/registry-repository';
import {
	HotkeyTargetRepository,
	type HotkeyTargetStoragePort,
} from '../src/background/hotkey-target-repository';
import { registerRegistryHandlers } from '../src/background/handlers/registry';

function createRegistryStorage(initial: DomainEntry[] = []): RegistryStoragePort & { entries: DomainEntry[] } {
	let updatedAt = 1_700_000_000_000;
	const storage = {
		entries: structuredClone(initial),
		async get() {
			return structuredClone(storage.entries);
		},
		async query(domain: string, fingerprint: string) {
			const normalized = normalizeHostname(domain);
			return storage.entries.find((entry) => entry.fingerprint === fingerprint
				&& entry.domain === normalized)
				?? storage.entries.find((entry) => entry.fingerprint === createSiteRouteFingerprint(domain))
				?? null;
		},
		async add(
			domain: string,
			source: DomainSource,
			route: MediaRoute = 'capture',
			_fingerprint?: string,
		): Promise<RegistryResult> {
			const normalized = normalizeHostname(domain);
			const identity = normalized ? createSiteRouteFingerprint(normalized) : null;
			if (!normalized || !identity) return { success: false, reason: 'invalid_route_identity' };
			// Deliberately split read/write across an await so a missing owner queue loses updates.
			const next = structuredClone(storage.entries);
			await Promise.resolve();
			const existing = next.find((entry) => entry.fingerprint === identity);
			if (existing) {
				existing.domain = normalized;
				existing.source = source;
				existing.route = route;
				existing.updatedAt = updatedAt++;
				storage.entries = next;
				return { success: true, reason: 'updated', entry: existing };
			}
			const entry: DomainEntry = {
				domain: normalized,
				fingerprint: identity,
				route,
				source,
				updatedAt: updatedAt++,
			};
			next.push(entry);
			storage.entries = next;
			return { success: true, entry };
		},
		async remove(fingerprint: string): Promise<RegistryResult> {
			const next = storage.entries.filter((entry) => entry.fingerprint !== fingerprint);
			if (next.length === storage.entries.length) return { success: false, reason: 'not_found' };
			storage.entries = next;
			return { success: true };
		},
		async markProbed(domain: string, fingerprint: string, route: MediaRoute): Promise<RegistryResult> {
			return storage.add(domain, 'auto', route, fingerprint);
		},
	};
	return storage;
}

describe('SPECTRA v2 media route registry contracts', () => {
	test('strictly validates route and fingerprint payloads', () => {
		const base = { protocolVersion: 2, requestId: 'registry-request' };
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.add',
			payload: { domain: 'BÜCHER.example.', route: 'capture' },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.add',
			payload: { domain: 'example.com', route: 'capture', source: 'auto' },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.mark-probed',
			payload: {
				domain: 'media.example',
				fingerprint: 'media:v1:0123456789abcdef',
				route: 'direct',
			},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.registry.query',
			payload: { domain: 'media.example' },
		})).toBe(false);
		expect(isSpectraRequestEnvelope({
			...base,
			type: 'spectra.hotkey-target.set',
			payload: { tabId: 7 },
		})).toBe(true);
	});

	test('rejects duplicate fingerprints and unknown response fields', () => {
		const entry: DomainEntry = {
			domain: 'example.com',
			fingerprint: 'site:example.com',
			route: 'capture',
			source: 'user',
			updatedAt: 1,
		};
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({ entries: [entry] }))).toBe(true);
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({
			entries: [{ ...entry, domain: 'media.example' }],
		}))).toBe(false);
		expect(isSpectraResponse('spectra.registry.get', rpcSuccess({
			entries: [entry, { ...entry, domain: 'media.example' }],
		}))).toBe(false);
		expect(isSpectraResponse('spectra.registry.add', rpcSuccess({
			entries: [{ ...entry, source: 'auto' }],
			entry: { ...entry, source: 'auto' },
			created: true,
		}))).toBe(false);
		expect(isSpectraResponse('spectra.registry.remove', rpcSuccess({
			entries: [],
			removed: true,
			extra: true,
		}))).toBe(false);
	});
});

describe('background-owned media route repository', () => {
	test('collapses legacy per-video entries into one user-preferred site record', () => {
		const entries = normalizeRegistryEntries([
			{
				domain: 'video.example.com',
				fingerprint: 'media:v1:0123456789abcdef',
				route: 'capture',
				source: 'auto',
				updatedAt: 30,
			},
			{
				domain: 'video.example.com',
				fingerprint: 'media:v1:fedcba9876543210',
				route: 'direct',
				source: 'auto',
				updatedAt: 40,
			},
			{
				domain: 'video.example.com',
				fingerprint: 'media:v1:0011223344556677',
				route: 'capture',
				source: 'user',
				updatedAt: 1,
			},
		]);
		expect(entries).toEqual([{
			domain: 'video.example.com',
			fingerprint: 'site:video.example.com',
			route: 'capture',
			source: 'user',
			updatedAt: 1,
		}]);
	});

	test('normalizes site fallbacks and does not lose concurrent writes', async () => {
		const storage = createRegistryStorage();
		const repository = new RegistryRepository(storage);
		const [first, second] = await Promise.all([
			repository.add('BÜCHER.Example.', 'user', 'capture'),
			repository.add('media.example.com', 'user', 'direct'),
		]);

		expect(first.entry).toMatchObject({
			domain: 'xn--bcher-kva.example',
			fingerprint: 'site:xn--bcher-kva.example',
			route: 'capture',
		});
		expect(second.entry.route).toBe('direct');
		expect((await repository.getSnapshot()).entries).toHaveLength(2);
	});

	test('folds repeated media observations into one site route', async () => {
		const storage = createRegistryStorage();
		const repository = new RegistryRepository(storage);
		const first = 'media:v1:0123456789abcdef';
		const second = 'media:v1:fedcba9876543210';
		await repository.markProbed('video.example.com', first, 'capture');
		expect((await repository.getSnapshot()).entries).toEqual([expect.objectContaining({
			domain: 'video.example.com',
			fingerprint: 'site:video.example.com',
			route: 'capture',
		})]);
		await repository.markProbed('video.example.com', second, 'direct');
		expect((await repository.getSnapshot()).entries).toHaveLength(1);
		expect((await repository.query('video.example.com', first)).entry?.route).toBe('direct');
		expect((await repository.query('video.example.com', second)).entry?.route).toBe('direct');
		const removed = await repository.remove('site:video.example.com');
		expect(removed.removed).toBe(true);
		expect(removed.entries).toEqual([]);
	});

	test('collapses stored per-video routes before a v2 user route replaces the site decision', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const listeners: Array<(
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response: unknown) => void,
		) => boolean | undefined> = [];
		const localState: Record<string, unknown> = {
			mediaRouteRegistry: [
				{
					domain: 'xn--bcher-kva.example',
					fingerprint: 'media:v1:0123456789abcdef',
					source: 'auto',
					route: 'capture',
					updatedAt: 1,
				},
				{
					domain: 'xn--bcher-kva.example',
					fingerprint: 'media:v1:fedcba9876543210',
					source: 'auto',
					route: 'direct',
					updatedAt: 2,
				},
			],
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
			const snapshot = await new Promise<unknown>((resolve, reject) => {
				const handled = listener({
					protocolVersion: 2,
					requestId: 'site-collapse',
					type: 'spectra.registry.get',
					payload: {},
				}, { id: 'spectra-test' }, resolve);
				if (!handled) reject(new Error('Registry v2 request was not handled'));
			});
			expect(isSpectraResponse('spectra.registry.get', snapshot)).toBe(true);
			expect(localState.mediaRouteRegistry).toEqual([expect.objectContaining({
				domain: 'xn--bcher-kva.example',
				fingerprint: 'site:xn--bcher-kva.example',
				source: 'auto',
				route: 'direct',
			})]);
			const response = await new Promise<unknown>((resolve, reject) => {
				const handled = listener({
					protocolVersion: 2,
					requestId: 'user-add',
					type: 'spectra.registry.add',
					payload: { domain: 'BÜCHER.Example.', route: 'capture' },
				}, { id: 'spectra-test' }, resolve);
				if (!handled) reject(new Error('Registry v2 request was not handled'));
			});
			expect(isSpectraResponse('spectra.registry.add', response)).toBe(true);
			expect(localState.mediaRouteRegistry).toEqual([expect.objectContaining({
				domain: 'xn--bcher-kva.example',
				fingerprint: 'site:xn--bcher-kva.example',
				source: 'user',
				route: 'capture',
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
