import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	STORAGE_KEY,
} from '../src/system/userscripts/storage';
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
	scripts: UserScript[],
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
	if (originalChrome === undefined) {
		delete (globalThis as unknown as { chrome?: unknown }).chrome;
	} else {
		(globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
	}
});

describe('UserScripts storage schema boundary', () => {
	test('distinguishes a missing key from corrupt persisted state', () => {
		const missing = parseUserScriptsStorageValue(undefined);
		expect(missing.ready).toBe(true);
		expect(missing.failed).toBe(false);
		expect(missing.globalEnabled).toBe(true);

		for (const corrupt of [null, { scripts: 'not-an-array' }, { scripts: [], globalEnabled: 'yes' }]) {
			const parsed = parseUserScriptsStorageValue(corrupt);
			expect(parsed.ready).toBe(true);
			expect(parsed.failed).toBe(true);
			expect(parsed.globalEnabled).toBe(false);
			expect(parsed.scripts).toHaveLength(0);
		}
	});

	test('filters malformed script rows and freezes the accepted projection', () => {
		const parsed = parseUserScriptsStorageValue({
			globalEnabled: true,
			scripts: [
				script(),
				{ id: 'partial', enabled: true },
				script({ id: 'bad-type', type: 'binary' as UserScript['type'] }),
			],
			toolbarConfig: { order: ['add', 'import'], hideOnOverflow: true },
		});
		expect(parsed.failed).toBe(false);
		expect(parsed.scripts.map((item) => item.id)).toEqual(['script-one']);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.scripts)).toBe(true);
		expect(Object.isFrozen(parsed.scripts[0])).toBe(true);
		expect(Object.isFrozen(parsed.scripts[0]?.matches)).toBe(true);
		expect(parsed.toolbarConfig).toEqual({ order: ['add', 'import'], hideOnOverflow: true });
	});
});

describe('UserScripts external-store lifecycle', () => {
	test('shares one physical read/listener across multiple subscribers', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribeA = subscribeUserScriptsStorage(() => undefined);
		const unsubscribeB = subscribeUserScriptsStorage(() => undefined);

		expect(storage.getCalls).toBe(1);
		expect(storage.addCalls).toBe(1);
		expect(storage.listenerCount()).toBe(1);

		gate.resolve({ [STORAGE_KEY]: state([script()]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts).toHaveLength(1);

		unsubscribeA();
		expect(storage.listenerCount()).toBe(1);
		expect(storage.removeCalls).toBe(0);
		unsubscribeB();
		expect(storage.listenerCount()).toBe(0);
		expect(storage.removeCalls).toBe(1);
		expect(getUserScriptsStorageSnapshot().ready).toBe(false);
	});

	test('lets a live storage event outrank an older hydration read', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribe = subscribeUserScriptsStorage(() => undefined);

		storage.emit(state([script({ id: 'event' })], false));
		expect(getUserScriptsStorageSnapshot().scripts[0]?.id).toBe('event');
		expect(getUserScriptsStorageSnapshot().globalEnabled).toBe(false);

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
			expect(current.scripts).toHaveLength(0);
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
	test('keeps all SidePanel projections free of duplicate userscript storage observers', () => {
		expect(kernelHookSource).not.toContain('chrome.storage');
		expect(kernelHookSource).toContain('system/userscripts/hooks/useUserScriptsSnapshot');
		expect(activeServicesSource).toContain('system/userscripts/storage-authority');
		expect(activeServicesSource).not.toContain('halo_userscripts');
		expect(fullHookSource).not.toContain('getUserScriptsState');
		expect(fullHookSource).not.toContain('createUserScriptsStateLoader');
		expect(fullHookSource).toContain('refreshUserScriptsStorage');
	});
});
