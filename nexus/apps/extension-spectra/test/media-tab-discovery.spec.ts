import { describe, expect, test } from 'bun:test';
import { createMediaTabDiscovery } from '../src/background/media-tab-discovery';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => { resolve = accept; });
	return { promise, resolve };
}
const tabs = Array.from({ length: 8 }, (_, index) => ({
	id: index + 1,
	url: `https://media.example/${index}`,
})) as chrome.tabs.Tab[];
const policy = { concurrency: 2, probeTimeoutMs: 10, scanTimeoutMs: 100 };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const complete = (total: number) => ({
	status: 'complete', total, examined: total, pending: 0, failed: 0, denied: 0, stale: 0, unknown: 0,
});
const result = (found: boolean) => ({ outcome: found ? 'found' as const : 'no-media' as const, documentId: 'document' });

describe('bounded media tab inventory', () => {
	test('does not coalesce a new document generation with an unsettled old probe', async () => {
		const old = deferred<ReturnType<typeof result>>();
		let generation = 1;
		const starts: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 1),
			seed: () => new Set(),
			documentGeneration: () => generation,
			probe: (_tabId, startedGeneration) => {
				starts.push(startedGeneration);
				return startedGeneration === 1 ? old.promise : Promise.resolve(result(true));
			},
		}, policy);
		expect((await discover()).coverage.pending).toBe(1);
		generation = 2;
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(1) });
		expect(starts).toEqual([1, 2]);
		old.resolve(result(true));
		await flush();
	});

	test('coalesces simultaneous scans and respects physical concurrency', async () => {
		let queries = 0;
		let running = 0;
		let maximum = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: async () => { queries++; return tabs; },
			seed: () => new Set(),
			documentGeneration: () => 0,
			probe: async () => {
				running++; maximum = Math.max(maximum, running);
				await Promise.resolve(); running--; return result(true);
			},
		}, policy);
		const a = discover();
		const b = discover();
		expect(a).toBe(b);
		expect(await a).toEqual({ tabs: [1, 2, 3, 4, 5, 6, 7, 8], coverage: complete(8) });
		expect(queries).toBe(1);
		expect(maximum).toBe(2);
	});

	test('returns partial evidence without multiplying hung probes on a repeated scan', async () => {
		const pending = deferred<ReturnType<typeof result>>();
		let starts = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs,
			seed: () => new Set([8]),
			documentGeneration: () => 0,
			probe: () => { starts++; return pending.promise; },
		}, policy);
		const first = await discover();
		expect(first).toMatchObject({ tabs: [8], coverage: { status: 'degraded', examined: 1, pending: 7 } });
		expect(await discover()).toMatchObject({ tabs: [8], coverage: { status: 'degraded', examined: 1, pending: 7 } });
		expect(starts).toBe(2);
		pending.resolve(result(true));
		await flush();
		expect(first.coverage.status).toBe('degraded');
		// Settled old replies never alter an already returned inventory. A fresh
		// scan must obtain and validate fresh observations for the current document.
		expect(await discover()).toEqual({ tabs: [1, 2, 3, 4, 5, 6, 7, 8], coverage: complete(8) });
		expect(starts).toBe(9);
	});

	test('never multiplies a hung tabs query and reports failure rather than empty success', async () => {
		const pending = deferred<chrome.tabs.Tab[]>();
		let queries = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: () => { queries++; return pending.promise; },
			seed: () => new Set(),
			documentGeneration: () => 0,
			probe: async () => result(true),
		}, { ...policy, scanTimeoutMs: 10 });
		await expect(discover()).rejects.toThrow('query timed out');
		await expect(discover()).rejects.toThrow('query timed out');
		expect(queries).toBe(1);
		pending.resolve(tabs);
		await flush();
		expect((await discover()).tabs).toHaveLength(8);
		expect(queries).toBe(2);
	});

	test('reports incomplete evidence for receiver failures without probing restricted schemes', async () => {
		const probed: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [...tabs.slice(0, 2), { id: 9, url: 'chrome://settings' } as chrome.tabs.Tab],
			seed: () => new Set(),
			documentGeneration: () => 0,
			probe: async (id) => { probed.push(id); if (id === 1) throw new Error('missing receiver'); return result(true); },
		}, policy);
		expect(await discover()).toMatchObject({ tabs: [2], coverage: { status: 'degraded', examined: 1, denied: 1, unknown: 1 } });
		expect(probed).toEqual([1, 2]);
	});

	test('does not convert an audible seed on a restricted page into complete coverage', async () => {
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [{ id: 9, audible: true, url: 'chrome://settings' } as chrome.tabs.Tab],
			seed: () => new Set([9]),
			documentGeneration: () => 0,
			probe: async () => result(true),
		}, policy);

		expect(await discover()).toEqual({
			tabs: [],
			coverage: {
				status: 'degraded',
				total: 1,
				examined: 0,
				pending: 0,
				failed: 1,
				denied: 1,
				stale: 0,
				unknown: 0,
			},
		});
	});
});
