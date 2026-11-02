// goal: pin the inventory boundary - a card exists only for a tab that said so
//
// The rules this file protects, in order of importance:
//   1. nothing is injected into a tab to decide whether it is a media tab;
//   2. a tab with no claim is not listed, not "pending", and not retried;
//   3. Chrome's audible flag is a claim, and it needs no document evidence;
//   4. a claim never outlives the document that made it or the tab that held it.

import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test';
import {
	captureStates,
	cleanupTabState,
	markTabActivated,
	markTabAudible,
	tabAudioStates,
} from '../src/background/state';
import { mediaFacts } from '../src/background/media-facts';
import { readMediaTabInventory } from '../src/background/media-inventory-runtime';
import {
	classifyMediaReport,
	recordMediaState,
} from '../src/background/handlers/tab-state';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

// The durable store is a module singleton, so every tab id this file touches is
// retired between cases. Isolation is explicit: a test may not inherit another
// test's verdict just because it reused an id.
const TOUCHED_TAB_IDS = [
	1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25, 30, 46, 50, 60, 61, 71, 72, 73, 74, 75,
];

beforeEach(() => { installChrome([]); });

afterEach(async () => {
	for (const tabId of TOUCHED_TAB_IDS) mediaFacts.forgetMediaFact(tabId);
	await mediaFacts.flushMediaFacts();
	tabAudioStates.clear();
	captureStates.clear();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('media tab inventory', () => {
	test('lists a tab only when its own document reported media or Chrome says it is audible', async () => {
		const tabs = [
			tab(1, { active: true }),
			tab(2, { audible: true }),
			tab(3),
			tab(4),
			tab(5, { url: 'chrome://settings/' }),
		];
		const { queries, injected } = installChrome(tabs);
		recordMediaState(3, 'document-3', { hasMediaElement: true, userInteracted: true, reportRevision: 1 });
		recordMediaState(4, 'document-4', { hasMediaElement: false, userInteracted: true, reportRevision: 1 });

		expect(await readMediaTabInventory()).toEqual({ tabs: [2, 3] });
		expect(queries()).toBe(1);
		// The whole point of the projection: deciding a tab is a media tab is a
		// read of what the tab already said, never an injection into the tab.
		expect(injected()).toEqual([]);
	});

	test('reports nothing as pending: a tab that never spoke is simply not a media tab', async () => {
		installChrome([tab(10), tab(11), tab(12)]);
		// A silent browser is an empty answer, not an outstanding question.
		expect(await readMediaTabInventory()).toEqual({ tabs: [] });
		expect(await readMediaTabInventory()).toEqual({ tabs: [] });
	});

	test('never probes a tab that is still committing its document', async () => {
		const { injected } = installChrome([
			tab(60, { status: 'loading' }),
			tab(61, { status: 'loading', audible: true }),
		]);
		// 60 没有说过任何话：它既不是卡片，也不会被唤醒去证明自己不是。
		// 61 同样没加载完，但 Chrome 自己说它正在出声——这条事实不依赖文档。
		expect(await readMediaTabInventory()).toEqual({ tabs: [61] });
		expect(injected()).toEqual([]);
	});

	test('drops a tab whose document is suspended, restricted, or gone', async () => {
		installChrome([
			tab(20),
			tab(21, { discarded: true }),
			tab(22, { url: 'chrome-extension://abc/popup.html' }),
			tab(23, { url: 'data:text/html,hi' }),
		]);
		for (const tabId of [20, 21, 22, 23]) {
			recordMediaState(tabId, `document-${tabId}`, {
				hasMediaElement: true, userInteracted: true, reportRevision: 1,
			});
		}
		// Only 20 is a page the Popup could control. A discarded renderer cannot
		// play, an extension page is not a media document, and an opaque origin has
		// no URL the card could name.
		expect(await readMediaTabInventory()).toEqual({ tabs: [20] });
	});

	test('retires a card when the same document reports that the media is gone', async () => {
		installChrome([tab(30)]);
		recordMediaState(30, 'document-30', { hasMediaElement: true, userInteracted: true, reportRevision: 1 });
		expect(await readMediaTabInventory()).toEqual({ tabs: [30] });

		recordMediaState(30, 'document-30', { hasMediaElement: false, userInteracted: true, reportRevision: 2 });
		expect(await readMediaTabInventory()).toEqual({ tabs: [] });
	});

	test('never revives a removed tab from its remembered report', async () => {
		installChrome([tab(25)]);
		recordMediaState(24, 'document-24', { hasMediaElement: true, userInteracted: false, reportRevision: 1 });
		expect(tabAudioStates.has(24)).toBe(true);

		expect(await readMediaTabInventory()).toEqual({ tabs: [] });
		// The bookkeeping row for a tab Chrome no longer reports is garbage; the
		// inventory read is what prunes it.
		expect(tabAudioStates.has(24)).toBe(false);
	});

	test('does not create or retain an activity lease for an activated non-media tab', async () => {
		const now = 1_000_000;
		installChrome([tab(46, { active: true })]);
		markTabActivated(46, now - 1_000);
		expect(tabAudioStates.has(46)).toBe(false);
		expect(await readMediaTabInventory(now)).toEqual({ tabs: [] });

		recordMediaState(46, 'document-46', { hasMediaElement: false, userInteracted: true, reportRevision: 1 });
		markTabActivated(46, now - 500);
		// 最近激活只是一条遥测，不是媒体事实：它不产生卡片。
		expect(await readMediaTabInventory(now)).toEqual({ tabs: [] });
	});

	test('ignores a never-audible Chrome update', () => {
		markTabAudible(50, false, 10);
		expect(tabAudioStates.has(50)).toBe(false);
	});

	test('returns ascending ids so the card list never depends on query order', async () => {
		installChrome([tab(9), tab(3), tab(7)]);
		for (const tabId of [9, 3, 7]) {
			recordMediaState(tabId, `document-${tabId}`, {
				hasMediaElement: true, userInteracted: true, reportRevision: 1,
			});
		}
		expect(await readMediaTabInventory()).toEqual({ tabs: [3, 7, 9] });
	});
});

describe('media report ordering', () => {
	test('keeps playback evidence optional and remembers interaction only within its document', () => {
		recordMediaState(75, 'document-75', { hasMediaElement: true, userInteracted: true, reportRevision: 1, playing: false, pausedAt: 100 });
		mediaFacts.touchMediaFact(75, 200);
		recordMediaState(75, 'document-75', { hasMediaElement: true, userInteracted: false, reportRevision: 2, playing: true });
		expect(mediaFacts.readMediaFact(75)).toMatchObject({ playing: true, pausedAt: null, userInteracted: true, usedAt: 200, reportRevision: 2 });
		recordMediaState(75, 'document-next', { hasMediaElement: true, userInteracted: false, reportRevision: 1 });
		expect(mediaFacts.readMediaFact(75)).toMatchObject({ documentId: 'document-next', userInteracted: false });
		expect(mediaFacts.readMediaFact(75)?.playing).toBeUndefined();
		expect(mediaFacts.readMediaFact(75)?.pausedAt).toBeUndefined();
		expect(mediaFacts.readMediaFact(75)?.usedAt).toBeUndefined();
	});
	test('keeps document report ordering after activity bookkeeping has expired', async () => {
		installChrome([tab(75)]);
		recordMediaState(75, 'document-75', { hasMediaElement: true, userInteracted: false, reportRevision: 5 });
		expect(await readMediaTabInventory()).toEqual({ tabs: [75] });
		expect(tabAudioStates.has(75)).toBe(false);
		recordMediaState(75, 'document-75', { hasMediaElement: false, userInteracted: false, reportRevision: 4 });
		expect(mediaFacts.readMediaFact(75)).toMatchObject({ documentId: 'document-75', outcome: 'found', reportRevision: 5 });
		expect(await readMediaTabInventory()).toEqual({ tabs: [75] });
	});
	test('keeps the newest report revision for one exact document', () => {
		recordMediaState(71, 'document-71', { hasMediaElement: true, userInteracted: false, reportRevision: 2 });
		recordMediaState(71, 'document-71', { hasMediaElement: false, userInteracted: false, reportRevision: 1 });
		expect(tabAudioStates.get(71)).toMatchObject({ documentId: 'document-71', reportRevision: 2, hasMediaElement: true });
	});

	test('does not let an unversioned v2 report create or replace an ordered media fact', () => {
		expect(classifyMediaReport({})).toEqual({ status: 'legacy-unversioned' });
		expect(classifyMediaReport({ reportRevision: 2 })).toEqual({ status: 'ordered', revision: 2 });
		recordMediaState(73, 'document-73', { hasMediaElement: true, userInteracted: false, reportRevision: 2 });
		recordMediaState(73, 'document-73', { hasMediaElement: false, userInteracted: false });
		recordMediaState(74, 'document-74', { hasMediaElement: true, userInteracted: false });
		expect(tabAudioStates.get(73)).toMatchObject({ reportRevision: 2, hasMediaElement: true });
		expect(tabAudioStates.has(74)).toBe(false);
	});

	test('preserves a new document report when old-document async cleanup settles late', () => {
		recordMediaState(72, 'document-new', { hasMediaElement: true, userInteracted: false, reportRevision: 1 });
		cleanupTabState(72, { preserveMedia: true });
		expect(tabAudioStates.get(72)).toMatchObject({
			documentId: 'document-new',
			reportRevision: 1,
			hasMediaElement: true,
		});
	});
});

function tab(
	id: number,
	overrides: {
		active?: boolean; audible?: boolean; url?: string; windowId?: number;
		status?: chrome.tabs.Tab['status']; discarded?: boolean;
	} = {},
): chrome.tabs.Tab {
	return {
		id,
		index: id,
		pinned: false,
		highlighted: false,
		windowId: overrides.windowId ?? 1,
		active: overrides.active ?? false,
		incognito: false,
		selected: overrides.active ?? false,
		discarded: overrides.discarded ?? false,
		autoDiscardable: true,
		groupId: -1,
		audible: overrides.audible ?? false,
		status: overrides.status ?? 'complete',
		url: overrides.url ?? `https://example-${id}.test/watch`,
	};
}

// `scripting` is intentionally absent from the fake: the inventory must not be
// able to inject anything, so a regression that reintroduces a probe fails here
// with a missing-API error instead of silently waking tabs.
function installChrome(tabs: chrome.tabs.Tab[]) {
	let queryCount = 0;
	const injected: Array<{ tabId: number }> = [];
	const query = mock(async () => { queryCount += 1; return tabs; });
	const storage = new Map<string, unknown>();
	const sessionStorage = new Map<string, unknown>();
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			tabs: { query },
			storage: {
				session: {
					async get(key: string) { return sessionStorage.has(key) ? { [key]: sessionStorage.get(key) } : {}; },
					async set(items: Record<string, unknown>) { for (const [key, value] of Object.entries(items)) sessionStorage.set(key, value); },
				},
				local: {
					async get(input: string | string[] | null) {
						const keys = typeof input === 'string' ? [input] : input ?? [...storage.keys()];
						return Object.fromEntries(keys.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)]));
					},
					async set(items: Record<string, unknown>) { for (const [key, value] of Object.entries(items)) storage.set(key, value); },
				},
			},
			// Present so a stray injection attempt is observable rather than fatal.
			scripting: { executeScript: mock(async ({ target }: { target: { tabId: number } }) => {
				injected.push({ tabId: target.tabId });
				return [];
			}) },
		},
	});
	return { queries: () => queryCount, injected: () => injected };
}
