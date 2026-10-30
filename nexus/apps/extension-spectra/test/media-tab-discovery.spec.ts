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
	status: 'complete',
	discarded: false,
	audible: false,
})) as chrome.tabs.Tab[];
const policy = { concurrency: 2, probeTimeoutMs: 10, scanTimeoutMs: 100 };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const complete = (total: number) => ({
	status: 'complete', total, examined: total, pending: 0, failed: 0, denied: 0, stale: 0, unknown: 0,
});
const result = (found: boolean) => ({ outcome: found ? 'found' as const : 'no-media' as const, documentId: 'document' });
const noFacts = {
	readFact: () => null,
	isFactCurrent: () => false,
	rememberFact: () => {},
};
const noCooldowns = {
	readCooldown: () => null,
	rememberCooldown: () => {},
	forgetCooldown: () => {},
};
const now = 1_000_000;
function factsFrom(values: Record<number, import('../src/background/media-tab-discovery').MediaFact>) {
	return {
		readFact: (tabId: number) => values[tabId] ?? null,
		isFactCurrent: (fact: import('../src/background/media-tab-discovery').MediaFact) =>
			fact.outcome === 'found' || now - fact.at < 10_000,
		rememberFact: (tabId: number, documentId: string | null, outcome: 'found' | 'no-media') => {
			if (documentId !== null) values[tabId] = { documentId, outcome, at: now, source: 'probe' };
		},
		...noCooldowns,
	};
}

describe('bounded media tab inventory', () => {
	test('does not coalesce a new document generation with an unsettled old probe', async () => {
		const old = deferred<ReturnType<typeof result>>();
		let generation = 1;
		const starts: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 1),
			seed: () => new Set(),
			documentGeneration: () => generation,
			...noFacts,
			...noCooldowns,
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
			...noFacts,
			...noCooldowns,
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
			...noFacts,
			...noCooldowns,
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
			...noFacts,
			...noCooldowns,
			probe: async () => result(true),
		}, { ...policy, scanTimeoutMs: 10 });
		await expect(discover()).rejects.toThrow('query timed out');
		await expect(discover()).rejects.toThrow('query timed out');
		expect(queries).toBe(1);
		// This case owns query coalescing and capacity release. A one-tab recovery
		// keeps its 10 ms query timeout independent from the separately tested
		// bounded eight-tab probe schedule.
		pending.resolve(tabs.slice(0, 1));
		await flush();
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(1) });
		expect(queries).toBe(2);
	});

	test('reports incomplete evidence for receiver failures without probing restricted schemes', async () => {
		const probed: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [...tabs.slice(0, 2), { id: 9, url: 'chrome://settings' } as chrome.tabs.Tab],
			seed: () => new Set(),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			probe: async (id) => { probed.push(id); if (id === 1) throw new Error('missing receiver'); return result(true); },
		}, policy);
		expect(await discover()).toMatchObject({ tabs: [2], coverage: { status: 'degraded', total: 2, examined: 1, denied: 0, unknown: 1, failed: 1, pending: 0, stale: 0 } });
		expect(probed).toEqual([1, 2]);
	});

	test('excludes restricted pages from inventory coverage entirely', async () => {
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [{ id: 9, audible: true, url: 'chrome://settings' } as chrome.tabs.Tab],
			seed: () => new Set([9]),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			probe: async () => result(true),
		}, policy);

		expect(await discover()).toEqual({
			tabs: [],
			coverage: complete(0),
		});
	});

	test('excludes discarded tabs from probing, visibility, and coverage entirely', async () => {
		// A discarded tab is unloaded: its renderer is suspended and cannot host
		// active media. Probing it would force Chrome to wake (reload) the page, so
		// it is dropped from the visible set and coverage like restricted pages.
		const probed: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [
				tabs[0],
				{ id: 9, url: 'https://media.example/discarded', discarded: true } as chrome.tabs.Tab,
			],
			seed: () => new Set([9]),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(1) });
		expect(probed).toEqual([1]);
	});

	test('excludes discarded tabs from the non-blocking readNow projection as well', async () => {
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [
				tabs[0],
				{ id: 9, url: 'https://media.example/discarded', discarded: true } as chrome.tabs.Tab,
			],
			seed: () => new Set([9]),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			probe: async () => result(true),
		}, policy);
		const inventory = await discover.readNow();
		// The discarded tab never enters coverage (would otherwise force Chrome to
		// wake the suspended page); the live media tab stays pending for the
		// background convergence sweep instead of blocking the popup read.
		expect(inventory.tabs).toEqual([]);
		expect(inventory.coverage).toEqual({
			status: 'degraded', total: 1, examined: 0, pending: 1, failed: 1, denied: 0, stale: 0, unknown: 0,
		});
	});

	test('keeps complete coverage when extension-internal pages coexist with media tabs', async () => {
		const probed: number[] = [];
		const discover = createMediaTabDiscovery({
			queryTabs: async () => [tabs[0], { id: 9, url: 'chrome-extension://abc/popup.html' } as chrome.tabs.Tab],
			seed: () => new Set(),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(1) });
		expect(probed).toEqual([1]);
	});

	test('reuses a persisted found fact without re-probing and counts it visible', async () => {
		const probed: number[] = [];
		const facts = factsFrom({ 3: { documentId: 'document-3', outcome: 'found', at: now, source: 'probe' } });
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 4),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...facts,
			probe: async (id) => { probed.push(id); return result(false); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [3], coverage: complete(4) });
		expect(probed).toEqual([1, 2, 4]);
	});

	test('skips probing tabs with a fresh no-media fact and keeps them examined', async () => {
		const probed: number[] = [];
		const facts = factsFrom({ 2: { documentId: 'document-2', outcome: 'no-media', at: now, source: 'probe' } });
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 3),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...facts,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1, 3], coverage: complete(3) });
		expect(probed).toEqual([1, 3]);
	});

	test('re-probes a tab whose no-media fact has expired', async () => {
		const probed: number[] = [];
		const facts = factsFrom({ 2: { documentId: 'document-2', outcome: 'no-media', at: now - 60_000, source: 'probe' } });
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 3),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...facts,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1, 2, 3], coverage: complete(3) });
		expect(probed).toEqual([1, 2, 3]);
	});

	test('records a settled probe outcome as a reusable fact for later scans', async () => {
		const probed: number[] = [];
		const facts = factsFrom({});
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 2),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...facts,
			probe: async (id) => { probed.push(id); return result(id === 1); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(2) });
		expect(probed).toEqual([1, 2]);
		// 第二次扫描复用已固化的事实：不再探测。
		expect(await discover()).toEqual({ tabs: [1], coverage: complete(2) });
		expect(probed).toEqual([1, 2]);
	});

	test('excludes a durably denied tab from probing and coverage entirely', async () => {
		const probed: number[] = [];
		const cooldowns: Record<number, import('../src/background/media-tab-discovery').MediaProbeCooldown> = {
			3: { outcome: 'denied', until: Number.MAX_SAFE_INTEGER },
		};
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 4),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			readCooldown: (tabId: number) => cooldowns[tabId] ?? null,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1, 2, 4], coverage: complete(3) });
		expect(probed).toEqual([1, 2, 4]);
	});

	test('projects an active transient cooldown without re-probing', async () => {
		const probed: number[] = [];
		const cooldowns: Record<number, import('../src/background/media-tab-discovery').MediaProbeCooldown> = {
			2: { outcome: 'unknown', until: Number.MAX_SAFE_INTEGER },
		};
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 3),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			readCooldown: (tabId: number) => cooldowns[tabId] ?? null,
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		const inventory = await discover();
		expect(inventory.tabs).toEqual([1, 3]);
		expect(inventory.coverage).toMatchObject({ total: 3, examined: 2, unknown: 1, failed: 1, status: 'degraded' });
		expect(probed).toEqual([1, 3]);
	});

	test('forgets an expired cooldown and re-probes the tab', async () => {
		const probed: number[] = [];
		const cooldowns: Record<number, import('../src/background/media-tab-discovery').MediaProbeCooldown> = {
			2: { outcome: 'unknown', until: Date.now() - 1 },
		};
		const discover = createMediaTabDiscovery({
			queryTabs: async () => tabs.slice(0, 3),
			seed: () => new Set(),
			documentGeneration: () => 0,
			...noFacts,
			...noCooldowns,
			readCooldown: (tabId: number) => cooldowns[tabId] ?? null,
			forgetCooldown: (tabId: number) => { delete cooldowns[tabId]; },
			probe: async (id) => { probed.push(id); return result(true); },
		}, policy);
		expect(await discover()).toEqual({ tabs: [1, 2, 3], coverage: complete(3) });
		expect(probed).toEqual([1, 2, 3]);
		expect(cooldowns[2]).toBeUndefined();
	});
});
