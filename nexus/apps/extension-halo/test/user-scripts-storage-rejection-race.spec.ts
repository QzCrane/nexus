import { afterEach, expect, test } from 'bun:test';
import {
	STORAGE_KEY,
} from '../src/system/userscripts/storage';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
	userScriptsStorageAuthorityTestApi,
} from '../src/system/userscripts/storage-authority';
import type { UserScript } from '../src/system/userscripts/types';

function deferred<T>() {
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((_resolve, rejectPromise) => { reject = rejectPromise; });
	return { promise, reject };
}

const originalChrome = (globalThis as unknown as { chrome?: unknown }).chrome;

afterEach(() => {
	userScriptsStorageAuthorityTestApi.reset();
	if (originalChrome === undefined) delete (globalThis as unknown as { chrome?: unknown }).chrome;
	else (globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
});

test('a newer storage event also outranks rejection from an older hydration read', async () => {
	const gate = deferred<Record<string, unknown>>();
	let listener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
	(globalThis as unknown as { chrome: unknown }).chrome = {
		storage: {
			local: { get: () => gate.promise },
			onChanged: {
				addListener: (next: typeof listener) => { listener = next; },
				removeListener: () => { listener = undefined; },
			},
		},
	};
	const unsubscribe = subscribeUserScriptsStorage(() => undefined);
	const liveScript: UserScript = {
		id: 'live',
		name: 'Live',
		description: '',
		code: '',
		enabled: true,
		type: 'javascript',
		matches: ['*://*/*'],
		runAt: 'document_idle',
		order: 0,
		runCount: 0,
		createdAt: 1,
		updatedAt: 1,
	};
	listener?.({
		[STORAGE_KEY]: {
			newValue: { scripts: [liveScript], globalEnabled: true },
		} as chrome.storage.StorageChange,
	}, 'local');

	gate.reject(new Error('older read failed'));
	await Promise.resolve();
	await Promise.resolve();

	const current = getUserScriptsStorageSnapshot();
	expect(current.failed).toBe(false);
	expect(current.scripts[0]?.id).toBe('live');
	unsubscribe();
});
