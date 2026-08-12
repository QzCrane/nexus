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

const authoritySource = readFileSync(new URL('../src/system/userscripts/storage-authority.ts', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8');
const activeServicesSource = readFileSync(new URL('../src/components/sidepanel/ActiveServicesContext.tsx', import.meta.url), 'utf8');
const settingsHookSource = readFileSync(new URL('../src/kernel/hooks/use-settings.ts', import.meta.url), 'utf8');
const kernelHookSource = readFileSync(new URL('../src/kernel/hooks/use-user-scripts.ts', import.meta.url), 'utf8');
const fullHookSource = readFileSync(new URL('../src/system/userscripts/hooks/useUserScripts.ts', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/system/userscripts/hooks/useScriptEditor.ts', import.meta.url), 'utf8');
const importHookSource = readFileSync(new URL('../src/system/userscripts/hooks/useImportExport.ts', import.meta.url), 'utf8');
const importExportSource = readFileSync(new URL('../src/system/userscripts/import-export.ts', import.meta.url), 'utf8');
const i18nCoreSource = readFileSync(new URL('../src/i18n/i18n-core.ts', import.meta.url), 'utf8');
const i18nHookSource = readFileSync(new URL('../src/i18n/index.ts', import.meta.url), 'utf8');
const sidepanelScrollSource = readFileSync(new URL('../src/entry/sidepanel-scroll.ts', import.meta.url), 'utf8');

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

function state(scripts: unknown[], globalEnabled = true): Record<string, unknown> {
	return { scripts, globalEnabled };
}

interface StorageMock {
	readonly getCalls: number;
	readonly addCalls: number;
	readonly removeCalls: number;
	listenerCount(): number;
	emit(changes: Record<string, chrome.storage.StorageChange>, areaName?: string): void;
	emitUserScripts(value: unknown): void;
}

let originalChrome: unknown;

function installStorageMock(read: () => Promise<Record<string, unknown>>): StorageMock {
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
		emit(changes, areaName = 'local') {
			for (const listener of [...listeners]) listener(changes, areaName);
		},
		emitUserScripts(value) {
			this.emit({
				[STORAGE_KEY]: { newValue: value } as chrome.storage.StorageChange,
			});
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
	if (originalChrome === undefined) delete (globalThis as unknown as { chrome?: unknown }).chrome;
	else (globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
});

describe('UserScripts canonical persistence parser', () => {
	test('distinguishes missing state from corrupt state', () => {
		const missing = parseUserScriptsStorageValue(undefined);
		expect(missing.ready).toBe(true);
		expect(missing.failed).toBe(false);
		expect(missing.globalEnabled).toBe(true);

		for (const corrupt of [
			null,
			{ scripts: 'bad' },
			{ scripts: [], globalEnabled: 'yes' },
			{ scripts: [], toolbarConfig: { order: ['bogus'], hideOnOverflow: true } },
			{ scripts: [], toolbarConfig: { order: ['add', 'add', 'import'], hideOnOverflow: true } },
		]) {
			const parsed = parseUserScriptsStorageValue(corrupt);
			expect(parsed.failed).toBe(true);
			expect(parsed.globalEnabled).toBe(false);
			expect(parsed.scripts).toHaveLength(0);
		}
	});

	test('fails the entire snapshot when any row is malformed', () => {
		for (const malformed of [
			{ id: 'partial', enabled: true },
			script({ id: 'empty-matches', matches: [] }),
			script({ id: 'blank-match', matches: ['  '] }),
			script({ id: 'bad-owner', managedBy: 'other' as UserScript['managedBy'] }),
		]) {
			const parsed = parseUserScriptsStorageValue(state([script(), malformed]));
			expect(parsed.failed).toBe(true);
			expect(parsed.scripts).toHaveLength(0);
		}
	});

	test('preserves ownership and future structured metadata losslessly and frozen', () => {
		const parsed = parseUserScriptsStorageValue({
			globalEnabled: true,
			scripts: [{
				...script({
					id: 'packaged',
					saatToolId: 'bilibili-plus',
					managedBy: 'packaged-script',
					moduleBuiltIn: true,
				}),
				futureOwnership: {
					version: 2,
					provenance: ['manifest', 'generated-runtime'],
					flags: { persistent: true },
				},
			}],
			toolbarConfig: { order: ['add', 'export', 'import'], hideOnOverflow: true },
		});
		expect(parsed.failed).toBe(false);
		const accepted = parsed.scripts[0] as typeof parsed.scripts[number] & {
			readonly futureOwnership?: {
				readonly version: number;
				readonly provenance: readonly string[];
				readonly flags: { readonly persistent: boolean };
			};
		};
		expect(accepted.managedBy).toBe('packaged-script');
		expect(accepted.moduleBuiltIn).toBe(true);
		expect(accepted.saatToolId).toBe('bilibili-plus');
		expect(accepted.futureOwnership?.provenance).toEqual(['manifest', 'generated-runtime']);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.scripts)).toBe(true);
		expect(Object.isFrozen(accepted)).toBe(true);
		expect(Object.isFrozen(accepted.matches)).toBe(true);
		expect(Object.isFrozen(accepted.futureOwnership)).toBe(true);
		expect(Object.isFrozen(accepted.futureOwnership?.provenance)).toBe(true);
		expect(Object.isFrozen(parsed.toolbarConfig?.order)).toBe(true);
	});

	test('rejects unsafe/non-finite extension metadata', () => {
		for (const extra of [
			{ future: Number.NaN },
			{ future: () => undefined },
		]) {
			expect(parseUserScriptsStorageValue(state([{ ...script(), ...extra }])).failed).toBe(true);
		}
	});
});

describe('UserScripts external-store ordering', () => {
	test('shares one read and one physical Chrome listener across consumers', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribeA = subscribeUserScriptsStorage(() => undefined);
		const unsubscribeB = subscribeUserScriptsStorage(() => undefined);
		const unsubscribeOther = subscribeHaloStorageChanges(() => undefined);
		expect(storage.getCalls).toBe(1);
		expect(storage.addCalls).toBe(1);
		expect(storage.listenerCount()).toBe(1);
		gate.resolve({ [STORAGE_KEY]: state([script()]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts).toHaveLength(1);
		unsubscribeA();
		unsubscribeB();
		expect(storage.listenerCount()).toBe(1);
		unsubscribeOther();
		expect(storage.listenerCount()).toBe(0);
		expect(storage.removeCalls).toBe(1);
	});

	test('lets a live event outrank an older hydration resolution', async () => {
		const gate = deferred<Record<string, unknown>>();
		const storage = installStorageMock(() => gate.promise);
		const unsubscribe = subscribeUserScriptsStorage(() => undefined);
		storage.emitUserScripts(state([script({ id: 'event' })], false));
		gate.resolve({ [STORAGE_KEY]: state([script({ id: 'stale-read' })], true) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts[0]?.id).toBe('event');
		expect(getUserScriptsStorageSnapshot().globalEnabled).toBe(false);
		unsubscribe();
	});

	test('fails closed on physical read failure', async () => {
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

	test('fences old hydration across stop/remount', async () => {
		const first = deferred<Record<string, unknown>>();
		const second = deferred<Record<string, unknown>>();
		let request = 0;
		installStorageMock(() => (++request === 1 ? first.promise : second.promise));
		const unsubscribeFirst = subscribeUserScriptsStorage(() => undefined);
		unsubscribeFirst();
		const unsubscribeSecond = subscribeUserScriptsStorage(() => undefined);
		first.resolve({ [STORAGE_KEY]: state([script({ id: 'old' })]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts).toHaveLength(0);
		second.resolve({ [STORAGE_KEY]: state([script({ id: 'new' })]) });
		await flushMicrotasks();
		expect(getUserScriptsStorageSnapshot().scripts[0]?.id).toBe('new');
		unsubscribeSecond();
	});
});

describe('SidePanel realm storage transport', () => {
	test('isolates subscriber failures while delivering the same event to later domains', () => {
		const storage = installStorageMock(async () => ({}));
		const originalError = console.error;
		console.error = () => undefined;
		let delivered = 0;
		try {
			const unsubscribeBroken = subscribeHaloStorageChanges(() => { throw new Error('broken domain'); });
			const unsubscribeHealthy = subscribeHaloStorageChanges(() => { delivered += 1; });
			storage.emit({ other_key: { newValue: 1 } as chrome.storage.StorageChange });
			expect(delivered).toBe(1);
			unsubscribeBroken();
			unsubscribeHealthy();
		} finally {
			console.error = originalError;
		}
	});

	test('routes high-fanout/default SidePanel observers through the global bus', () => {
		for (const source of [authoritySource, activeServicesSource, settingsHookSource, i18nCoreSource, sidepanelScrollSource]) {
			expect(source).toContain('subscribeHaloStorageChanges');
			expect(source).not.toContain('chrome.storage.onChanged.addListener');
		}
		expect(kernelHookSource).not.toContain('chrome.storage');
		expect(activeServicesSource).not.toContain('halo_userscripts');
	});

	test('keeps locale and pre-React scroll hydration event-first', () => {
		expect(i18nCoreSource.indexOf('subscribeHaloStorageChanges((changes, area)')).toBeLessThan(
			i18nCoreSource.indexOf('export const initI18n'),
		);
		expect(i18nCoreSource).toContain('storageRevision === readRevision');
		expect(i18nHookSource.indexOf('listeners.add(onUpdate)')).toBeLessThan(
			i18nHookSource.indexOf('onUpdate();'),
		);
		expect(sidepanelScrollSource.indexOf('const unsubscribeStorageChanges = subscribeHaloStorageChanges')).toBeLessThan(
			sidepanelScrollSource.indexOf('chrome.storage.sync.get'),
		);
		expect(sidepanelScrollSource).toContain('storageRevision !== readRevision');
	});
});

describe('UserScripts write and Background boundaries', () => {
	test('owned editor/import writes validate before persistence and do not force refresh reads', () => {
		expect(editorSource).toContain('matches.length === 0');
		expect(editorSource).not.toContain('await loadScripts()');
		expect(importHookSource).not.toContain('await loadScripts()');
		expect(importExportSource).toContain('parseUserScriptsStorageValue');
		expect(importExportSource).toContain('if (parsed.failed)');
		expect(importExportSource).toContain('script.managedBy !== undefined');
	});

	test('Background consumes the same fail-closed parser before registration', () => {
		expect(registrySource).toContain('parseUserScriptsStorageValue(stateResult[STORAGE_KEY])');
		expect(registrySource).toContain('parseUserScriptsStorageValue(stateResult[SAAT_STORAGE_KEY])');
		expect(registrySource).toContain('if (userState.failed || saatState.failed)');
		expect(registrySource).not.toContain("return result.length > 0 ? result : ['*://*/*']");
	});

	test('full panel mutations rely on event publication rather than duplicate refreshes', () => {
		expect(fullHookSource).not.toContain('getUserScriptsState');
		const toggleBlock = fullHookSource.slice(
			fullHookSource.indexOf('const handleGlobalToggle'),
			fullHookSource.indexOf('const handleTest'),
		);
		expect(toggleBlock).not.toContain('loadScripts()');
	});
});
