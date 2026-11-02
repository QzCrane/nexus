import { describe, expect, test } from 'bun:test';
import { createMediaFacts } from '../src/background/media-facts';

class FakeLocalStorage {
	readonly values: Record<string, unknown> = {};
	readonly setCalls: Array<Record<string, unknown>> = [];

	async get(storageKey: string): Promise<Record<string, unknown>> {
		return storageKey in this.values
			? { [storageKey]: structuredClone(this.values[storageKey]) }
			: {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		this.setCalls.push(structuredClone(items));
		Object.assign(this.values, structuredClone(items));
	}
}

function installChrome(storage: FakeLocalStorage): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { storage: { session: storage } },
	});
}

function restoreChrome(descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, 'chrome', descriptor);
	else Reflect.deleteProperty(globalThis, 'chrome');
}

// Auto-flush is a microtask chain; one macrotask tick drains it deterministically.
function drainAutoFlush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const now = 2_000_000_000;

describe('media facts session persistence', () => {
	test('does not fall back to old local evidence when session storage cannot be read', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const local = new FakeLocalStorage();
		const session = new FakeLocalStorage();
		let localReads = 0;
		local.get = async () => { localReads += 1; return {}; };
		session.get = async () => { throw new Error('session-unavailable'); };
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local, session } } });
		try {
			await expect(createMediaFacts().ready()).rejects.toThrow('session-unavailable');
			expect(localReads).toBe(0);
		} finally { restoreChrome(originalChrome); }
	});
	test('ignores old local facts when the current browser session has no matching fact', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const local = new FakeLocalStorage();
		const session = new FakeLocalStorage();
		local.values['spectra.media-facts.v1'] = {
			1: { schemaVersion: 2, documentId: 'previous-browser-document', outcome: 'found', at: now, source: 'report', reportRevision: 99 },
		};
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local, session } } });
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.readMediaFact(1)).toBeNull();
			facts.rememberMediaFact(1, 'current-browser-document', 'found', 'report', now + 1, 1);
			await facts.flushMediaFacts();
			expect(local.setCalls).toEqual([]);
			expect(session.values['spectra.media-facts.v1']).toMatchObject({ 1: { documentId: 'current-browser-document', reportRevision: 1 } });
			const workerRestart = createMediaFacts();
			await workerRestart.ready();
			expect(workerRestart.readMediaFact(1)?.documentId).toBe('current-browser-document');
			Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local, session: new FakeLocalStorage() } } });
			const browserRestart = createMediaFacts();
			await browserRestart.ready();
			expect(browserRestart.readMediaFact(1)).toBeNull();
		} finally { await drainAutoFlush(); restoreChrome(originalChrome); }
	});

	test('records first unavailability without inventing a pause or changing report order and clears it on resume', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.markMediaUnavailable(1, true, now)).toBe(false);
			facts.rememberMediaFact(1, 'legacy-document', 'found', 'probe', now);
			expect(facts.markMediaUnavailable(1, true, now)).toBe(false);
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now, 4, { playing: true, usedAt: now - 10 });
			expect(facts.markMediaUnavailable(1, true, now + 1)).toBe(true);
			expect(facts.markMediaUnavailable(1, true, now + 100)).toBe(false);
			expect(facts.readMediaFact(1)).toMatchObject({ playing: true, pausedAt: null, usedAt: now - 10, reportRevision: 4, at: now, unavailableAt: now + 1 });
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now + 101, 5, { playing: true });
			expect(facts.readMediaFact(1)?.unavailableAt).toBe(now + 1);
			await facts.flushMediaFacts();
			const restarted = createMediaFacts();
			await restarted.ready();
			expect(restarted.readMediaFact(1)?.unavailableAt).toBe(now + 1);
			expect(restarted.markMediaUnavailable(1, false, now + 102)).toBe(true);
			expect(restarted.markMediaUnavailable(1, false, now + 103)).toBe(false);
			expect(restarted.readMediaFact(1)?.unavailableAt).toBeUndefined();
			expect(restarted.readMediaFact(1)).toMatchObject({ reportRevision: 5, usedAt: now - 10, playing: true });
			await restarted.flushMediaFacts();
		} finally { await drainAutoFlush(); restoreChrome(originalChrome); }
	});
	test('does not turn a failed hydrate into a zero high-water mark and retries with retirement intact', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { schemaVersion: 2, documentId: 'retired-document', outcome: 'found', at: now, source: 'report', reportRevision: 8 },
			2: { schemaVersion: 2, documentId: 'document-live', outcome: 'found', at: now, source: 'report', reportRevision: 9 },
		};
		const get = storage.get.bind(storage);
		let available = false;
		storage.get = async (key) => { if (!available) throw new Error('store-unavailable'); return get(key); };
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await expect(facts.ready()).rejects.toThrow('store-unavailable');
			facts.forgetMediaFact(1);
			await expect(facts.flushMediaFacts()).rejects.toThrow('store-unavailable');
			available = true;
			await facts.ready();
			expect(facts.readMediaFact(1)).toBeNull();
			facts.rememberMediaFact(2, 'document-live', 'no-media', 'report', now + 1, 8);
			expect(facts.readMediaFact(2)).toMatchObject({ outcome: 'found', reportRevision: 9 });
			await facts.flushMediaFacts();
		} finally { await drainAutoFlush(); restoreChrome(originalChrome); }
	});
	test('retains same-document interaction and browser usage without promoting unknown playback', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.touchMediaFact(1, now)).toBe(false);
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now, 1, { playing: false, pausedAt: now, userInteracted: true });
			expect(facts.touchMediaFact(1, now + 10)).toBe(true);
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now + 20, 2, { userInteracted: false });
			expect(facts.readMediaFact(1)).toMatchObject({ reportRevision: 2, usedAt: now + 10, userInteracted: true });
			expect(facts.readMediaFact(1)?.playing).toBeUndefined();
			expect(facts.readMediaFact(1)?.pausedAt).toBeUndefined();
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now + 30, 3, { playing: true, pausedAt: now });
			expect(facts.readMediaFact(1)).toMatchObject({ playing: true, pausedAt: null, usedAt: now + 10 });
			facts.rememberMediaFact(1, 'document-b', 'found', 'report', now + 40, 1, { userInteracted: false });
			expect(facts.readMediaFact(1)).toMatchObject({ documentId: 'document-b', reportRevision: 1, userInteracted: false });
			expect(facts.readMediaFact(1)?.usedAt).toBeUndefined();
			await facts.flushMediaFacts();
		} finally { restoreChrome(originalChrome); }
	});

	test('serializes concurrent flushes so delayed writes cannot resurrect a retired fact', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		let releaseWrite: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => { releaseWrite = resolve; });
		const set = storage.set.bind(storage);
		let writes = 0;
		storage.set = async (items) => { writes += 1; if (writes === 1) await pending; await set(items); };
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			facts.rememberMediaFact(1, 'document-a', 'found', 'report', now, 2);
			const first = facts.flushMediaFacts();
			await Promise.resolve();
			facts.forgetMediaFact(1);
			const last = facts.flushMediaFacts();
			expect(writes).toBe(1);
			releaseWrite?.();
			await Promise.all([first, last]);
			expect(writes).toBe(2);
			expect(storage.values['spectra.media-facts.v1']).toEqual({});
		} finally { releaseWrite?.(); await drainAutoFlush(); restoreChrome(originalChrome); }
	});

	test('a legacy forecast cannot replace an ordered persisted document while hydrating', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { schemaVersion: 2, documentId: 'document-a', outcome: 'found', at: now, source: 'report', reportRevision: 8 },
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			facts.rememberMediaFact(1, 'document-forecast', 'no-media', 'probe', now + 1);
			await facts.ready();
			expect(facts.readMediaFact(1)).toMatchObject({ documentId: 'document-a', outcome: 'found', reportRevision: 8 });
			await facts.flushMediaFacts();
		} finally { restoreChrome(originalChrome); }
	});
	test('keeps the report high-water mark across worker restart and ignores unordered forecasts', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const first = createMediaFacts();
			await first.ready();
			first.rememberMediaFact(1, 'document-a', 'found', 'report', now, 9);
			await first.flushMediaFacts();
			const restarted = createMediaFacts();
			await restarted.ready();
			restarted.rememberMediaFact(1, 'document-a', 'no-media', 'report', now + 1, 8);
			restarted.rememberMediaFact(1, 'document-a', 'no-media', 'probe', now + 2);
			expect(restarted.readMediaFact(1)).toMatchObject({ outcome: 'found', reportRevision: 9 });
			restarted.rememberMediaFact(1, 'document-a', 'no-media', 'report', now - 1, 10);
			expect(restarted.readMediaFact(1)).toMatchObject({ outcome: 'no-media', reportRevision: 10 });
			await restarted.flushMediaFacts();
		} finally { restoreChrome(originalChrome); }
	});

	test('does not resurrect a retired stored document when retirement precedes hydration', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { documentId: 'document-old', outcome: 'found', at: now, source: 'report' },
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			facts.forgetMediaFact(1);
			await facts.ready();
			expect(facts.readMediaFact(1)).toBeNull();
			await facts.flushMediaFacts();
			expect(storage.values['spectra.media-facts.v1']).toEqual({});
		} finally { restoreChrome(originalChrome); }
	});

	test('merges an ordered stored revision over an older report that raced hydration', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { schemaVersion: 2, documentId: 'document-a', outcome: 'found', at: now, source: 'report', reportRevision: 8 },
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			facts.rememberMediaFact(1, 'document-a', 'no-media', 'report', now + 1, 7);
			await facts.ready();
			expect(facts.readMediaFact(1)).toMatchObject({ outcome: 'found', reportRevision: 8 });
			await facts.flushMediaFacts();
		} finally { restoreChrome(originalChrome); }
	});

	test('strictly decodes ordered records instead of treating malformed v2 as legacy', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		const valid = { schemaVersion: 2, documentId: 'document-a', outcome: 'found', at: now, source: 'report', reportRevision: 4 };
		storage.values['spectra.media-facts.v1'] = {
			1: valid, 2: { ...valid, reportRevision: -1 }, 3: { ...valid, reportRevision: 1.5 },
			4: { ...valid, extra: true }, 5: { ...valid, source: 'probe' },
			6: { ...valid, schemaVersion: 3 }, 7: { ...valid, at: Number.MAX_SAFE_INTEGER + 1 },
			8: { ...valid, playing: 'false' }, 9: { ...valid, pausedAt: -1 },
			10: { ...valid, playing: true, pausedAt: now }, 11: { ...valid, usedAt: Infinity },
			12: { ...valid, userInteracted: 1 }, 13: { ...valid, unavailableAt: -1 },
			14: { ...valid, unavailableAt: NaN },
			'01': valid,
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.size()).toBe(1);
			expect(facts.readMediaFact(1)).toEqual(valid);
		} finally { restoreChrome(originalChrome); }
	});
	test('remembers and forgets facts with a coalesced auto-flush', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.readMediaFact(1)).toBeNull();

			facts.rememberMediaFact(1, 'document-a', 'found', 'probe', now);
			expect(facts.readMediaFact(1)).toEqual({
				documentId: 'document-a', outcome: 'found', at: now, source: 'probe',
			});
			// 变更后无需显式 flush：自动持久化已把事实写入本地存储。
			await drainAutoFlush();
			expect(storage.setCalls).toHaveLength(1);
			expect(storage.values['spectra.media-facts.v1']).toEqual({
				1: { documentId: 'document-a', outcome: 'found', at: now, source: 'probe' },
			});

			// 同批次内第二次变更合并进下一次写入（coalescing）。
			facts.rememberMediaFact(1, 'document-a', 'no-media', 'report', now + 1);
			facts.rememberMediaFact(2, 'document-b', 'found', 'report', now + 2);
			await drainAutoFlush();
			expect(storage.values['spectra.media-facts.v1']).toEqual({
				1: { documentId: 'document-a', outcome: 'no-media', at: now + 1, source: 'report' },
				2: { documentId: 'document-b', outcome: 'found', at: now + 2, source: 'report' },
			});

			facts.forgetMediaFact(1);
			await drainAutoFlush();
			expect(storage.values['spectra.media-facts.v1']).toEqual({
				2: { documentId: 'document-b', outcome: 'found', at: now + 2, source: 'report' },
			});
			expect(facts.readMediaFact(1)).toBeNull();
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('explicit flush stays dirty-gated and never clobbers an in-flight mutation', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			await facts.flushMediaFacts();
			// 无变更：显式 flush 不产生写入。
			expect(storage.setCalls).toHaveLength(0);

			facts.rememberMediaFact(1, 'document-a', 'found', 'probe', now);
			// 在显式 flush 的写入期间发生并发变更：revision 检测到竞态，
			// dirty 保持置位，下一轮 scheduleFlush 会把新快照持久化。
			const pending = facts.flushMediaFacts();
			facts.rememberMediaFact(2, 'document-b', 'found', 'report', now + 1);
			await pending;
			await drainAutoFlush();
			expect(storage.values['spectra.media-facts.v1']).toEqual({
				1: { documentId: 'document-a', outcome: 'found', at: now, source: 'probe' },
				2: { documentId: 'document-b', outcome: 'found', at: now + 1, source: 'report' },
			});
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('hydrates persisted facts and guards malformed entries', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { documentId: 'document-a', outcome: 'found', at: now, source: 'probe' },
			2: { documentId: '', outcome: 'found', at: now, source: 'probe' },
			3: { documentId: 'document-c', outcome: 'bogus', at: now, source: 'probe' },
			4: 'not-an-object',
			'-5': { documentId: 'document-d', outcome: 'found', at: now, source: 'probe' },
			6: { documentId: 'document-e', outcome: 'no-media', at: now - 86_400_000, source: 'report' },
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			expect(facts.readMediaFact(1)?.outcome).toBe('found');
			expect(facts.readMediaFact(2)).toBeNull();
			expect(facts.readMediaFact(3)).toBeNull();
			expect(facts.readMediaFact(4)).toBeNull();
			expect(facts.readMediaFact(-5)).toBeNull();
			expect(facts.readMediaFact(6)?.outcome).toBe('no-media');
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('a fresher pre-hydration observation wins over a stored fact', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		storage.values['spectra.media-facts.v1'] = {
			1: { documentId: 'stale-document', outcome: 'found', at: now, source: 'probe' },
		};
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			// 内容脚本上报在首次 storage 读取完成前到达：新观测优先，hydrate 不得覆盖。
			facts.rememberMediaFact(1, 'fresh-document', 'no-media', 'report', now + 5_000);
			await facts.ready();
			expect(facts.readMediaFact(1)).toEqual({
				documentId: 'fresh-document', outcome: 'no-media', at: now + 5_000, source: 'report',
			});
			await drainAutoFlush();
			expect(storage.values['spectra.media-facts.v1'][1]).toEqual({
				documentId: 'fresh-document', outcome: 'no-media', at: now + 5_000, source: 'report',
			});
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('hydrate is memoized while later mutations share its completed read', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			const first = facts.readMediaFact(9);
			// 第二次 ready 不重复读取。
			await facts.ready();
			expect(facts.readMediaFact(9)).toBe(first);
			facts.rememberMediaFact(9, 'document-9', 'found', 'probe', now);
			expect(facts.readMediaFact(9)?.outcome).toBe('found');
			// 收尾前排空 auto-flush 微任务，避免其在 chrome 桩卸载后触发。
			await drainAutoFlush();
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('keeps a verdict until the document that reported it changes or leaves', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		installChrome(new FakeLocalStorage());
		try {
			const facts = createMediaFacts();
			facts.rememberMediaFact(3, 'document-3', 'found', 'report', now);
			expect(facts.readMediaFact(3)).toEqual({
				documentId: 'document-3', outcome: 'found', at: now, source: 'report',
			});
			// A verdict is not a lease: only lifecycle retirement removes it.
			facts.forgetMediaFact(3);
			expect(facts.readMediaFact(3)).toBeNull();
			await facts.flushMediaFacts();
		} finally { restoreChrome(originalChrome); }
	});

	test('ignores facts with a null document id', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeLocalStorage();
		installChrome(storage);
		try {
			const facts = createMediaFacts();
			await facts.ready();
			facts.rememberMediaFact(7, null, 'found', 'probe', now);
			expect(facts.readMediaFact(7)).toBeNull();
			await facts.flushMediaFacts();
			await drainAutoFlush();
			expect(storage.setCalls).toHaveLength(0);
		} finally {
			restoreChrome(originalChrome);
		}
	});
});
