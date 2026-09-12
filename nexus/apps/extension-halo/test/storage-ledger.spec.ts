import { afterEach, describe, expect, test } from 'bun:test';
import { conditionalLedgerRemove, conditionalLedgerWrite, ledgerRevisionKey, readLedgerEntry, scheduleStorageSet } from '../../../packages/nexus-kernel/src/storage';
import { saveToClipboardHistory, getClipboardHistory, togglePin, deleteItem } from '../src/tools/clipboard/core';
import { MAX_HISTORY, MAX_HISTORY_BYTES, parseClipboardHistory, STORAGE_KEY, clipboardHistoryBytes, type ClipboardItem } from '../src/tools/clipboard/types';
import { parseSessions, restoreSession, saveSession, getSessions, deleteSession, admitSessions, SESSIONS_STORAGE_KEY, type Session } from '../src/tools/session-manager/core';
import { parseArchiveEntries, captureCurrentPage, MAX_ARCHIVE_ENTRIES } from '../src/tools/archive/core';
import { closeArchiveDB, saveMHTMLBlob } from '../src/tools/archive/storage';

const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const previousIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

afterEach(() => {
	closeArchiveDB();
	for (const [property, descriptor] of [['chrome', previousChrome], ['indexedDB', previousIndexedDB]] as const) {
		if (descriptor) Object.defineProperty(globalThis, property, descriptor);
		else Reflect.deleteProperty(globalThis, property);
	}
});

/** In-memory chrome.storage.local that persists every key it is given. */
function installStorage(initial: Record<string, unknown> = {}) {
	const store: Record<string, unknown> = { ...initial };
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			storage: {
				local: {
					get: async (keys: string | string[]) => {
						const requested = typeof keys === 'string' ? [keys] : keys;
						const result: Record<string, unknown> = {};
						for (const key of requested) if (key in store) result[key] = structuredClone(store[key]);
						return result;
					},
					set: async (data: Record<string, unknown>) => {
						for (const [key, value] of Object.entries(data)) store[key] = structuredClone(value);
					},
					remove: async (keys: string | string[]) => {
						for (const key of typeof keys === 'string' ? [keys] : keys) delete store[key];
					},
				},
			},
		},
	});
	return { store };
}

function installWindowsForRestore(options: {
	tabFailures?: Set<number>;
	created: { url: string; pinned: boolean; windowId?: number }[];
	pinUpdates: { tabId: number; pinned: boolean }[];
}) {
	let tabCall = 0;
	let windowId = 7;
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			windows: {
				create: async () => {
					const id = windowId++;
					return { id, tabs: [{ id: 900 }] };
				},
			},
			tabs: {
				update: async (tabId: number, properties: { pinned?: boolean }) => {
					options.pinUpdates.push({ tabId, pinned: properties.pinned === true });
					return { id: tabId };
				},
				create: async (createOptions: { url: string; pinned?: boolean; windowId?: number }) => {
					tabCall++;
					if (options.tabFailures?.has(tabCall)) throw new Error(`tab ${tabCall} create failed`);
					options.created.push({ url: createOptions.url, pinned: createOptions.pinned === true, windowId: createOptions.windowId });
					return { id: 100 + tabCall };
				},
			},
		},
	});
}

describe('storage ledger conditional writes', () => {
	test('a stale concurrent writer cannot silently overwrite the newer value', async () => {
		const { store } = installStorage();
		const first = conditionalLedgerWrite('key', { baseRevision: 0, value: { writer: 'first' } });
		const second = conditionalLedgerWrite('key', { baseRevision: 0, value: { writer: 'second' } });
		const firstOutcome = await first;
		expect(firstOutcome.kind).toBe('committed');
		const secondOutcome = await second;
		// The second writer detects the concurrent change and reports the stored
		// state instead of claiming its own blind overwrite committed.
		expect(secondOutcome.kind).toBe('external');
		if (secondOutcome.kind === 'external') {
			expect(secondOutcome.value).toEqual({ writer: 'first' });
			expect(secondOutcome.revision).toBe(1);
		}
		expect(store[ledgerRevisionKey('key')]).toBe(1);
	});

	test('remerge re-applies a lost mutation onto the fresh stored value', async () => {
		let hijacked = false;
		const store: Record<string, unknown> = {};
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: {
					local: {
						get: async (keys: string | string[]) => {
							const requested = typeof keys === 'string' ? [keys] : keys;
							const result: Record<string, unknown> = {};
							for (const key of requested) if (key in store) result[key] = structuredClone(store[key]);
							return result;
						},
						set: async (data: Record<string, unknown>) => {
							for (const [key, value] of Object.entries(data)) store[key] = structuredClone(value);
							// Simulate a concurrent context that commits after our set.
							if (!hijacked) {
								hijacked = true;
								store.merge = { op: 'foreign' };
								store[ledgerRevisionKey('merge')] = 2;
							}
						},
					},
				},
			},
		});
		const outcome = await conditionalLedgerWrite<{ op: string }>('merge', {
			baseRevision: 0,
			value: { op: 'add-b' },
			remerge: (current) => ({ op: `foreign+add-b:${(current as { op?: string }).op}` }),
		});
		expect(outcome.kind).toBe('committed');
		if (outcome.kind === 'committed') expect(outcome.value.op).toBe('foreign+add-b:foreign');
		expect(store.merge).toEqual({ op: 'foreign+add-b:foreign' });
	});

	test('a degraded transport that drops the revision key still commits by value', async () => {
		let seen: unknown;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: {
					local: {
						get: async (keys: string | string[]) => {
							const requested = typeof keys === 'string' ? [keys] : keys;
							const result: Record<string, unknown> = {};
							for (const key of requested) if (key === 'key' && seen !== undefined) result[key] = structuredClone(seen);
							return result;
						},
						set: async (data: Record<string, unknown>) => {
							// The legacy transport persists only the value key.
							if ('key' in data) seen = structuredClone(data.key);
						},
					},
				},
			},
		});
		const outcome = await conditionalLedgerWrite('key', { baseRevision: 0, value: { kept: true } });
		expect(outcome.kind).toBe('committed');
		expect(seen).toEqual({ kept: true });
	});

	test('an interleaved foreign write after the set is detected and reported', async () => {
		let setCalls = 0;
		const foreign = { hijacked: true };
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: {
					local: {
						get: async (keys: string | string[]) => {
							const requested = typeof keys === 'string' ? [keys] : keys;
							const result: Record<string, unknown> = {};
							for (const key of requested) if (key === 'key' && setCalls > 0) result[key] = structuredClone(foreign);
							return result;
						},
						set: async (data: Record<string, unknown>) => {
							setCalls++;
							void data;
						},
					},
				},
			},
		});
		const outcome = await conditionalLedgerWrite('key', { baseRevision: 0, value: { ours: true } });
		expect(outcome.kind).toBe('external');
		if (outcome.kind === 'external') expect(outcome.value).toEqual(foreign);
	});

	test('lane admission failure reports rejected instead of pretending success', async () => {
		installStorage();
		for (let index = 0; index < 64; index++) scheduleStorageSet({ fill: index });
		const outcome = await conditionalLedgerWrite('overflow', { baseRevision: 0, value: { overflow: true } });
		expect(outcome.kind).toBe('rejected');
	});

	test('readLedgerEntry reports absent values with revision zero', async () => {
		const { store } = installStorage();
		store.present = 'v';
		store[ledgerRevisionKey('present')] = 4;
		expect(await readLedgerEntry('present')).toEqual({ value: 'v', revision: 4 });
		expect(await readLedgerEntry('absent')).toEqual({ value: undefined, revision: 0 });
	});

	test('conditional removal preserves tombstone absence and advances its revision', async () => {
		const { store } = installStorage({ module: false, [ledgerRevisionKey('module')]: 4 });
		const outcome = await conditionalLedgerRemove('module', { baseRevision: 4 });
		expect(outcome).toEqual({ kind: 'committed', revision: 5, value: undefined });
		expect(store.module).toBeUndefined();
		expect(store[ledgerRevisionKey('module')]).toBe(5);
	});
});

describe('clipboard cross-context convergence and budgets', () => {
	test('two concurrent appends from different contexts both survive', async () => {
		const { store } = installStorage();
		const first = saveToClipboardHistory('alpha');
		const second = saveToClipboardHistory('beta');
		await Promise.all([first, second]);
		const texts = (await getClipboardHistory()).map((item) => item.text);
		expect(texts).toContain('alpha');
		expect(texts).toContain('beta');
		expect(store[STORAGE_KEY]).toEqual(await getClipboardHistory());
	});

	test('history parsing drops malformed entries without shape coercion', () => {
		const parsed = parseClipboardHistory([
			{ id: 'a', text: 'kept', timestamp: 5, pinned: true, sourceUrl: 'https://x' },
			{ id: '', text: 'no id', timestamp: 6 },
			{ text: 'no id key', timestamp: 7 },
			{ id: 'c', text: 42, timestamp: 8 },
			{ id: 'd', text: 'no timestamp' },
			{ id: 'e', text: 'nan timestamp', timestamp: Number.NaN },
			'not-an-object',
			null,
		]);
		expect(parsed).toEqual([{ id: 'a', text: 'kept', timestamp: 5, pinned: true, sourceUrl: 'https://x' }]);
	});

	test('a single item above the byte budget is rejected explicitly', async () => {
		installStorage();
		await expect(saveToClipboardHistory('x'.repeat(MAX_HISTORY_BYTES + 1))).rejects.toThrow('byte budget');
		expect(await getClipboardHistory()).toHaveLength(0);
	});

	test('byte budget evicts the oldest unpinned entries before admitting new text', async () => {
		installStorage();
		const large = await saveToClipboardHistory('a'.repeat(400 * 1024));
		expect(large).toHaveLength(1);
		const second = await saveToClipboardHistory('b'.repeat(200 * 1024));
		expect(second.some((item) => item.text.startsWith('b'))).toBe(true);
		expect(second.some((item) => item.text.startsWith('a'))).toBe(false);
		expect(clipboardHistoryBytes(second)).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
	});

	test('pin, delete and clear keep pinned entries through the ledger', async () => {
		installStorage();
		const added = await saveToClipboardHistory('target');
		const id = added[0].id;
		await saveToClipboardHistory('other');
		const pinned = await togglePin(id);
		expect(pinned[0].id).toBe(id);
		expect(pinned[0].pinned).toBe(true);
		const remaining = await deleteItem('missing-id');
		expect(remaining.length).toBe(pinned.length);
	});

	test('entry ceiling still protects pinned entries from eviction', async () => {
		const full: ClipboardItem[] = Array.from({ length: MAX_HISTORY }, (_, index) => ({
			id: String(index),
			text: String(index),
			timestamp: index,
			pinned: true,
		}));
		installStorage({ [STORAGE_KEY]: full });
		await expect(saveToClipboardHistory('new')).rejects.toThrow('pinned');
	});
});

describe('session manager single-list authority', () => {
	test('session parsing drops malformed entries and normalizes tabs', () => {
		const valid: Session = { id: 's1', name: 'work', createdAt: 10, tabs: [{ url: 'https://a', title: 'A', pinned: true }] };
		const parsed = parseSessions([
			valid,
			{ id: '', name: 'no id', createdAt: 1, tabs: [] },
			{ id: 's2', name: 5, createdAt: 1, tabs: [] },
			{ id: 's3', name: 'bad tabs', createdAt: 1, tabs: 'no' },
			{ id: 's4', name: 'bad tab entry', createdAt: 1, tabs: [{ url: 1 }, null, { url: 'https://b', title: 7, pinned: 1 }] },
			null,
		]);
		expect(parsed[0]).toEqual(valid);
		// `pinned: 1` is not `true`: the parser never shape-coerces tab flags.
		expect(parsed[1].tabs).toEqual([{ url: 'https://b', title: '', pinned: false }]);
		expect(parsed).toHaveLength(2);
	});

	test('admission keeps the newest session even when it alone exceeds the byte ceiling', () => {
		const heavy: Session = { id: 'big', name: 'x'.repeat(2 * 1024 * 1024), createdAt: 2, tabs: [] };
		const older: Session = { id: 'old', name: 'older', createdAt: 1, tabs: [] };
		expect(admitSessions([heavy, older])).toEqual([heavy]);
	});

	test('save and delete mutate the single persisted list through the ledger', async () => {
		const { store } = installStorage();
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				...((globalThis as { chrome?: object }).chrome ?? {}),
				tabs: { query: async () => [{ url: 'https://a', title: 'A', pinned: false }, { url: 'https://b', title: 'B', pinned: true }] },
			},
		});
		const { sessions } = await saveSession('first');
		expect(sessions[0].tabs).toHaveLength(2);
		expect(store[SESSIONS_STORAGE_KEY]).toEqual(sessions);
		await saveSession('second');
		const listed = await getSessions();
		expect(listed.map((session) => session.name)).toEqual(['second', 'first']);
		const afterDelete = await deleteSession(listed[0].id);
		expect(afterDelete.map((session) => session.name)).toEqual(['first']);
		expect(store[SESSIONS_STORAGE_KEY]).toEqual(afterDelete);
	});

	test('new-window restore recreates pinned state and reports per-tab failures', async () => {
		const created: { url: string; pinned: boolean; windowId?: number }[] = [];
		const pinUpdates: { tabId: number; pinned: boolean }[] = [];
		installWindowsForRestore({ tabFailures: new Set([2]), created, pinUpdates });
		const session: Session = {
			id: 'r1',
			name: 'restore',
			createdAt: 1,
			tabs: [
				{ url: 'https://a', title: 'A', pinned: true },
				{ url: 'https://b', title: 'B', pinned: true },
				{ url: 'https://c', title: 'C', pinned: false },
			],
		};
		const report = await restoreSession(session, true);
		expect(report.restored).toBe(2);
		expect(report.pinned).toBe(2);
		expect(report.failed).toHaveLength(1);
		expect(created).toHaveLength(1);
		expect(created[0].url).toBe('https://b');
		expect(created[0].pinned).toBe(true);
		expect(created[0].windowId).toBeDefined();
		expect(pinUpdates).toEqual([{ tabId: 900, pinned: true }]);
	});

	test.each([false, true])('unsafe and invalid URLs report failures; newWindow=%s', async (newWindow) => {
		const created: { url: string; pinned: boolean }[] = [];
		installWindowsForRestore({ created, pinUpdates: [] });
		const session: Session = {
			id: 'r2',
			name: 'unsafe',
			createdAt: 1,
			tabs: [
				{ url: 'javascript:alert(1)', title: 'evil', pinned: false },
				{ url: 'invalid', title: 'broken', pinned: false },
				{ url: 'https://ok', title: 'ok', pinned: true },
			],
		};
		const report = await restoreSession(session, newWindow);
		expect(report.restored).toBe(1);
		expect(report.pinned).toBe(1);
		expect(report.failed).toEqual([
			{ url: 'javascript:alert(1)', title: 'evil', reason: 'URL scheme is not allowed' },
			{ url: 'invalid', title: 'broken', reason: 'URL is invalid' },
		]);
		expect(created).toEqual(newWindow ? [] : [{ url: 'https://ok', pinned: true }]);
	});
});

describe('archive metadata and blob consistency', () => {
	test('metadata parsing drops malformed entries', () => {
		const parsed = parseArchiveEntries([
			{ id: 'a', title: 'T', url: 'https://a', savedAt: 1, size: 10 },
			{ id: '', title: 'T', url: 'https://a', savedAt: 1, size: 10 },
			{ id: 'b', title: 'T', url: 'https://a', savedAt: 'late', size: 10 },
			{ id: 'c', title: 'T', url: 'https://a', savedAt: 1, size: Number.NaN },
			'text',
			null,
		]);
		expect(parsed).toEqual([{ id: 'a', title: 'T', url: 'https://a', savedAt: 1, size: 10 }]);
	});

	test('a capture whose metadata write fails rolls the blob back', async () => {
		const blobs = new Map<string, unknown>();
		installFakeArchiveDB(blobs);
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: { local: { get: async () => ({}), set: async () => { throw new Error('metadata rejected'); } } },
				tabs: { query: async () => [{ id: 1, url: 'https://page', title: 'Page' }] },
				pageCapture: { saveAsMHTML: async () => new Blob(['mhtml-bytes'], { type: 'multipart/related' }) },
			},
		});
		await expect(captureCurrentPage()).rejects.toThrow('not committed');
		expect(blobs.size).toBe(0);
	});

	test('a failed capture rollback reports both failures and preserves the orphan for reconciliation', async () => {
		const blobs = new Map<string, unknown>();
		installFakeArchiveDB(blobs, { abortDeletes: true });
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: { local: { get: async () => ({}), set: async () => { throw new Error('metadata rejected'); } } },
				tabs: { query: async () => [{ id: 1, url: 'https://page', title: 'Page' }] },
				pageCapture: { saveAsMHTML: async () => new Blob(['mhtml-bytes'], { type: 'multipart/related' }) },
			},
		});
		await expect(captureCurrentPage()).rejects.toThrow('blob rollback failed');
		expect(blobs.size).toBe(1);
	});

	test('a blob transaction that aborts after request success rejects', async () => {
		installStorage();
		const blobs = new Map<string, unknown>();
		installFakeArchiveDB(blobs, { abortPuts: true });
		await expect(saveMHTMLBlob('x', new Blob(['data']))).rejects.toThrow('forced abort');
		expect(blobs.size).toBe(0);
	});

	test('trimming the metadata list deletes the blobs of trimmed entries', async () => {
		const blobs = new Map<string, unknown>();
		installFakeArchiveDB(blobs);
		for (let index = 0; index <= MAX_ARCHIVE_ENTRIES + 2; index++) {
			blobs.set(String(index), { id: String(index), blob: new Blob([String(index)]), savedAt: index });
		}
		const full = Array.from({ length: MAX_ARCHIVE_ENTRIES + 2 }, (_, index) => ({
			id: String(index),
			title: `T${index}`,
			url: `https://e${index}`,
			savedAt: index,
			size: index,
		}));
		installStorage({ halo_archive_entries: full });
		const { saveEntryMeta } = await import('../src/tools/archive/core');
		const stored = await saveEntryMeta({ id: 'new', title: 'N', url: 'https://n', savedAt: 999, size: 1 });
		expect(stored).toHaveLength(MAX_ARCHIVE_ENTRIES);
		expect(stored.some((entry) => entry.id === 'new')).toBe(true);
		for (const id of ['49', '50', '51']) {
			expect(stored.some((entry) => entry.id === id)).toBe(false);
			expect(blobs.has(id)).toBe(false);
		}
		expect(blobs.has('48')).toBe(true);
	});
});

/**
 * Minimal IndexedDB double: requests succeed in a microtask and the owning
 * transaction completes afterwards, matching the real success ordering.
 */
function installFakeArchiveDB(blobs: Map<string, unknown>, options: { abortPuts?: boolean; abortDeletes?: boolean } = {}): void {
	const db = {
		addEventListener: () => undefined,
		close: () => undefined,
		transaction: (_name: string, _mode?: string) => {
			// The tx object itself carries the completion callbacks that
			// transactionDone() assigns after the requests are issued.
			const tx: Record<string, unknown> = {};
			const complete = (after: () => void, abort = false) => queueMicrotask(() => {
				after();
				if (abort) {
					tx.error = new Error('forced abort');
					(tx.onabort as (() => void) | null)?.();
					return;
				}
				(tx.oncomplete as (() => void) | null)?.();
			});
			return Object.assign(tx, {
				objectStore: () => ({
					put: (record: { id: string; blob: Blob; savedAt: number }) => {
						const request: Record<string, unknown> = {};
						complete(() => {
							if (!options.abortPuts) blobs.set(record.id, record);
							(request.onsuccess as (() => void) | null)?.();
						}, options.abortPuts);
						return request;
					},
					delete: (id: string) => {
						const request: Record<string, unknown> = {};
						complete(() => {
							if (!options.abortDeletes) blobs.delete(id);
							(request.onsuccess as (() => void) | null)?.();
						}, options.abortDeletes);
						return request;
					},
					get: (id: string) => {
						const request: Record<string, unknown> = { result: blobs.get(id) };
						complete(() => (request.onsuccess as (() => void) | null)?.());
						return request;
					},
					getAll: () => {
						const request: Record<string, unknown> = { result: [...blobs.values()] };
						complete(() => (request.onsuccess as (() => void) | null)?.());
						return request;
					},
				}),
			});
		},
	};
	const openRequest: Record<string, unknown> = { result: db };
	Object.defineProperty(globalThis, 'indexedDB', {
		configurable: true,
		value: {
			open: () => {
				queueMicrotask(() => (openRequest.onsuccess as (() => void) | null)?.());
				return openRequest;
			},
		},
	});
}
