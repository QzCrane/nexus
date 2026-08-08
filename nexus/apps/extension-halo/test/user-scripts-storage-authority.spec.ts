import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	haloStorageChangeBusTestApi,
	subscribeHaloStorageChanges,
} from '../src/kernel/core/storage-change-bus';
import { STORAGE_KEY } from '../src/system/userscripts/storage';
import {
	getUserScriptsStorageSnapshot,
	parseUserScriptsStorageValue,
	subscribeUserScriptsStorage,
	userScriptsStorageAuthorityTestApi,
} from '../src/system/userscripts/storage-authority';
import type { UserScript } from '../src/system/userscripts/types';

const kernelHookSource = readFileSync(
	new URL('../src/kernel/hooks/use-user-scripts.ts', import.meta.url),
	'utf8',
);
const activeServicesSource = readFileSync(
	new URL('../src/components/sidepanel/ActiveServicesContext.tsx', import.meta.url),
	'utf8',
);
const authoritySource = readFileSync(
	new URL('../src/system/userscripts/storage-authority.ts', import.meta.url),
	'utf8',
);
const fullHookSource = readFileSync(
	new URL('../src/system/userscripts/hooks/useUserScripts.ts', import.meta.url),
	'utf8',
);

type StorageListener = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
) => void;

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function script(overrides: Partial<UserScript> = {}): UserScript {
	return {
		id: 'script-one',
		name: 'Script One',
		description: 'test',
		code: 'console.log(1);',
		enabled: true,
		type: 'javascript',
		matches: ['*://*/*'],
		runAt: 'document_idle',
		order: 0,
		runCount: 0,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function state(
	scripts: unknown[],
	globalEnabled = true,
): Record<string, unknown> {
	return { scripts, globalEnabled };
}

interface StorageMock {
	getCalls: number;
	addCalls: number;
	removeCalls: number;
	listenerCount(): number;
	emit(value: unknown, areaName?: string): void;
}

let originalChrome: unknown;

function installStorageMock(
	read: () => Promise<Record<string, unknown>>,
): StorageMock {
	const listeners = new Set<StorageListener>();
	const stats = { getCalls: 0, addCalls: 0, removeCalls: 0 };
	const mock = {
		storage: {
			local: {
				get: async () => {
					stats.getCalls += 1;
					return read();
				},
			},
			onChanged: {
				addListener: (listener: StorageListener) => {
					stats.addCalls += 1;
					listeners.add(listener);
				},
				removeListener: (listener: StorageListener) => {
					stats.removeCalls += 1;
					listeners.delete(listener);
				},
			},
		},
	};
	(globalThis as unknown as { chrome: unknown }).chrome = mock;
	return {
		get getCalls() { return stats.getCalls; },
		get addCalls() { return stats.addCalls; },
		get removeCalls() { return stats.removeCalls; },
		listenerCount: () => listeners.size,
		emit(value, areaName = 'local') {
			const changes = {
				[STORAGE_KEY]: { newValue: value },
			} as unknown as Record<string, chrome.storage.StorageChange>;
			for (const listener of listeners) listener(changes, areaName);
		},
	};
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	originalChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
});

afterEach(() => {
	userScriptsStorageAuthorityTestApi.reset();
	haloStorageChangeBusTestApi.reset();
	if (originalChrome === undefined) {
		delete (globalThis as unknown as { chrome?: unknown }).chrome;
	} else {
		(globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
	}
});

describe('UserScripts persistence boundary', () => {
	test('distinguishes missing state from corrupt or failed state', () => {
		const missing = parseUserScriptsStorageValue(undefined);
		expect(missing.ready).toBe(true);
		expect(missing.failed).toBe(false);
		expect(missing.globalEnabled).toBe(true);

		for (const corrupt of [
			null,
			{ scripts: 'not-an-array' },
			{ scripts: [], globalEnabled: 'yes' },
			{ scripts: [], toolbarConfig: { order: 'bad', hideOnOverflow: true } },
		]) {
			const parsed = parseUserScriptsStorageValue(corrupt);
			expect(parsed.ready).toBe(true);
			expect(parsed.failed).toBe(true);
			expect(parsed.globalEnabled).toBe(false);
			expect(parsed.scripts).toHaveLength(0);
		}
	});

	test('fails the whole snapshot when any persisted script row is malformed', () => {
		for (const malformed of [
			{ id: 'partial', enabled: true },
			script({ id: 'bad-type', type: 'binary' as UserScript['type'] }),
			script({ id: 'bad-owner', managedBy: 'other' as UserScript['managedBy'] }),
		]) {
			const parsed = parseUserScriptsStorageValue(state([script(), malformed]));
			expect(parsed.failed).toBe(true);
			expect(parsed.globalEnabled).toBe(false);
			expect(parsed.scripts).toHaveLength(0);
		}
	});

	test('preserves canonical ownership plus future structured metadata losslessly and frozen', () => {
		const raw = {
			...script({
				id: 'packaged',
				saatToolId: 'bilibili-plus',
				managedBy: 'packaged-script',
				moduleBuiltIn: true,
			}),
			registryOwnership: {
				version: 2,
				provenance: ['manifest', 'generated-runtime'],
				flags: { persistent: true },
			},
		};
		const parsed = parseUserScriptsStorageValue({
			globalEnabled: true,
			scripts: [raw],
			toolbarConfig: { order: ['add', 'import'], hideOnOverflow: true },
		});
		expect(parsed.failed).toBe(false);
		const accepted = parsed.scripts[0] as Readonly<UserScript> & {
			readonly registryOwnership?: {
				readonly version: number;
				readonly provenance: readonly string[];
				readonly flags: { readonly persistent: boolean };
			};
		expect(accepted.managedBy).toBe('packaged-script');
		expect(accepted.moduleBuiltIn).toBe(true);
		expect(accepted.saatToolId).toBe('bilibili-plus');
		expect(accepted.registryOwnership).toEqual({
			version: 2,
			provenance: ['manifest', 'generated-runtime'],
			flags: { persistent: true },
		});
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.scripts)).toBe(true);
		expect(Object.isFrozen(accepted)).toBe(true);
		expect(Object.isFrozen(accepted.matches)).toBe(true);
		expect(Object.isFrozen(accepted.registryOwnership)).toBe(true);
		expect(Object.isFrozen(accepted.registryOwnership?.provenance)).toBe(true);
		expect(Object.isFrozen(accepted.registryOwnership?.flags)).toBe(true);
		expect(parsed.toolbarConfig).toEqual({ order: ['add', 'import'], hideOnOverflow: true });
		expect(Object.isFrozen(parsed.toolbarConfig?.order)).toBe(true);
	});

	test('rejects unsafe or non-finite extension metadata instead of silently stripping it', () => {
		for (const extra of [
			{ future: Number.NaN },
			{ future: () => undefined },
		]) {
			const parsed = parseUserScriptsStorageValue(state([{ ...script(), ...extra }]));
			expect(parsed.failed).toBe(true);
		}
	});
});

describe('UserScripts external-store lifecycle', () => {
	test('shares one physical read and one bus-backed Chrome listener across consumers', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribeA = subscribeUserScriptsStorage(() => undefined);
		const unsubscribeB = subscribeUserScriptsStorage(() => undefined);
		const unsubscribeOtherDomain = subscribeHaloStorageChanges(() => undefined);

		expect(storage.getCalls).toBe(1);
		expect(storage.addCalls).toBe(1);
		expect(storage.listenerCount()).toBe(1);
		expect(haloStorageChangeBusTestApi.subscriberCount).toBe(2);

		gate.resolve({ [STORAGE_KEY]: state([script()]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts).toHaveLength(1);

		unsubscribeA();
		unsubscribeB();
		expect(storage.listenerCount()).toBe(1);
		expect(storage.removeCalls).toBe(0);
		unsubscribeOtherDomain();
		expect(storage.listenerCount()).toBe(0);
		expect(storage.removeCalls).toBe(1);
	});

	test('lets a live storage event outrank an older hydration resolve', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribe = subscribeUserScriptsStorage(() => undefined);
		storage.emit(state([script({ id: 'event' })], false));
		gate.resolve({ [STORAGE_KEY]: state([script({ id: 'stale-read' })], true) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts[0]?.id).toBe('event');
		expect(getUserScriptsStorageSnapshot().globalEnabled).toBe(false);
		unsubscribe();
	});

	test('fails closed when the physical storage read fails', async () => {
		installStorageMock(async () => { throw new Error('storage unavailable'); });
		const originalError = console.error;
		console.error = () => undefined;
		try {
			const unsubscribe = subscribeUserScriptsStorage(() => undefined);
			await flushMicrotasks();
			const current = getUserScriptsStorageSnapshot();
			expect(current.ready).toBe(true);
			expect(current.failed).toBe(true);
			expect(current.globalEnabled).toBe(false);
			unsubscribe();
		} finally {
			console.error = originalError;
		}
	});

	test('fences an old hydration across unmount and remount', async () => {
		const first = deferred<Record<string, unknown>>();
		const second = deferred<Record<string, unknown>>();
		let request = 0;
		installStorageMock(() => (++request === 1 ? first.promise : second.promise));
		const unsubscribeFirst = subscribeUserScriptsStorage(() => undefined);
		unsubscribeFirst();
		const unsubscribeSecond = subscribeUserScriptsStorage(() => undefined);
		first.resolve({ [STORAGE_KEY]: state([script({ id: 'old-lifecycle' })]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts).toHaveLength(0);
		second.resolve({ [STORAGE_KEY]: state([script({ id: 'new-lifecycle' })]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts[0]?.id).toBe('new-lifecycle');
		unsubscribeSecond();
	});
});

describe('UserScripts authority ownership', () => {
	test('keeps all SidePanel projections free of direct duplicate Chrome observers', () => {
		expect(kernelHookSource).not.toContain('chrome.storage');
		expect(kernelHookSource).toContain('system/userscripts/hooks/useUserScriptsSnapshot');
		expect(fullHookSource).not.toContain('getUserScriptsState');
		expect(fullHookSource).not.toContain('createUserScriptsStateLoader');
		expect(fullHookSource).toContain('refreshUserScriptsStorage');
		expect(authoritySource).toContain('subscribeHaloStorageChanges');
		expect(authoritySource).not.toContain('chrome.storage.onChanged.addListener');
		expect(activeServicesSource).toContain('subscribeHaloStorageChanges');
		expect(activeServicesSource).not.toContain('chrome.storage.onChanged.addListener');
		expect(activeServicesSource).not.toContain('halo_userscripts');
	});

	test('does not publish script background IDs before the combined status projection is ready', () => {
		expect(activeServicesSource).toContain('if (!state.ready) return [];');
	});
});
