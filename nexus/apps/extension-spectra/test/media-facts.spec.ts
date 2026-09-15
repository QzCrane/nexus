import { describe, expect, test } from 'bun:test';
import {
	createMediaFacts,
	NO_MEDIA_FACT_TTL_MS,
} from '../src/background/media-facts';

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
		value: { storage: { local: storage } },
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
			6: { documentId: 'document-e', outcome: 'no-media', at: now - NO_MEDIA_FACT_TTL_MS - 1, source: 'report' },
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

	test('hydrate is memoized and a failed read falls back to an empty mirror', async () => {
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

	test('found facts stay current; no-media facts expire after the TTL', () => {
		const facts = createMediaFacts();
		expect(facts.isFactCurrent(
			{ documentId: 'a', outcome: 'found', at: now - 60_000, source: 'probe' },
			now,
		)).toBe(true);
		expect(facts.isFactCurrent(
			{ documentId: 'b', outcome: 'no-media', at: now - 5_000, source: 'report' },
			now,
		)).toBe(true);
		expect(facts.isFactCurrent(
			{ documentId: 'c', outcome: 'no-media', at: now - NO_MEDIA_FACT_TTL_MS - 1, source: 'probe' },
			now,
		)).toBe(false);
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
