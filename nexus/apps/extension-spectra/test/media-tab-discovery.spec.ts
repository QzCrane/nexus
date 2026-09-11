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

describe('bounded media tab inventory', () => {
	test('coalesces simultaneous scans and respects physical concurrency', async () => {
		let queries = 0;
		let running = 0;
		let maximum = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: async () => { queries++; return tabs; },
			seed: () => new Set(),
			probe: async () => {
				running++; maximum = Math.max(maximum, running);
				await Promise.resolve(); running--; return true;
			},
		}, policy);
		const a = discover();
		const b = discover();
		expect(a).toBe(b);
		expect(await a).toEqual({ tabs: [1, 2, 3, 4, 5, 6, 7, 8] });
		expect(queries).toBe(1);
		expect(maximum).toBe(2);
	});

	test('returns partial evidence without multiplying hung probes on a repeated scan', async () => {
		const pending = deferred<boolean>();
		let starts = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs,
			seed: () => new Set([8]),
			probe: () => { starts++; return pending.promise; },
		}, policy);
		const first = await discover();
		expect(first).toEqual({ tabs: [8], incomplete: true });
		expect(await discover()).toEqual({ tabs: [8], incomplete: true });
		expect(starts).toBe(2);
		pending.resolve(true);
		await flush();
		expect(first).toEqual({ tabs: [8], incomplete: true });
		// Settled old replies never alter an already returned inventory. A fresh
		// scan must obtain and validate fresh observations for the current document.
		expect(await discover()).toEqual({ tabs: [1, 2, 3, 4, 5, 6, 7, 8] });
		expect(starts).toBe(9);
	});

	test('never multiplies a hung tabs query and reports failure rather than empty success', async () => {
		const pending = deferred<chrome.tabs.Tab[]>();
		let queries = 0;
		const discover = createMediaTabDiscovery({
			queryTabs: () => { queries++; return pending.promise; },
			seed: () => new Set(),
			probe: async () => true,
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
			probe: async (id) => { probed.push(id); if (id === 1) throw new Error('missing receiver'); return true; },
		}, policy);
		expect(await discover()).toEqual({ tabs: [2], incomplete: true });
		expect(probed).toEqual([1, 2]);
	});
});
