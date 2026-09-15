import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	captureStates,
	cleanupTabState,
	markTabActivated,
	markTabAudible,
	tabAudioStates,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../src/background/state';
import {
	classifyMediaReport,
	recordMediaState,
	resolveVisibleTabs,
} from '../src/background/handlers/tab-state';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const complete = (total: number) => ({
	status: 'complete', total, examined: total, pending: 0, failed: 0, denied: 0, stale: 0, unknown: 0,
});

afterEach(() => {
	tabAudioStates.clear();
	captureStates.clear();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('complete visible media tab lifecycle', () => {
	test('discovers cold paused media in a child frame without loading the content runtime', async () => {
		const frames = [
			{ frameId: 0, documentId: 'document-top' },
			{ frameId: 3, documentId: 'document-child' },
		];
		const executeScript = mock(async () => [
			{ frameId: 0, documentId: 'document-top', result: false },
			{ frameId: 3, documentId: 'document-child', result: true },
		]);
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { query: async () => [tab(70)] },
				webNavigation: { getAllFrames: async () => frames },
				scripting: { executeScript },
			},
		});
		expect(await resolveVisibleTabs()).toEqual({ tabs: [70], coverage: complete(1) });
		expect(executeScript.mock.calls[0]?.[0]).toMatchObject({ target: { tabId: 70, allFrames: true } });
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

	test('discovers paused or muted media tabs without treating active non-media tabs as media', async () => {
		const now = 1_000_000;
		const { sendMessage } = installChrome([
			tab(1, { active: true }),
			tab(2, { audible: true }),
			tab(3),
			tab(4),
			tab(5, { url: 'chrome://settings/' }),
		], new Map([
			[1, 'empty'],
			[3, 'media'],
			[4, 'empty'],
		]));

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [2, 3], coverage: complete(4) });
		expect(sendMessage.mock.calls.map(([request]) => request.target.tabId).sort((a, b) => Number(a) - Number(b)))
			.toEqual([1, 3, 4]);
	});

	test('never admits ordinary active tabs from another window without media truth', async () => {
		const { sendMessage } = installChrome([
			tab(6, { active: true, windowId: 1 }),
			tab(7, { active: true, windowId: 2 }),
		], new Map([
			[6, 'empty'],
			[7, 'empty'],
		]));

		expect(await resolveVisibleTabs()).toEqual({ tabs: [], coverage: complete(2) });
		expect(sendMessage.mock.calls.map(([request]) => request.target.tabId).sort((a, b) => Number(a) - Number(b)))
			.toEqual([6, 7]);
	});

	test('reconstructs media inventory after service-worker heap loss', async () => {
		installChrome([
			tab(10),
			tab(11),
		], new Map([
			[10, 'media'],
			[11, 'empty'],
		]));

		expect(tabAudioStates.size).toBe(0);
		expect(await resolveVisibleTabs()).toEqual({ tabs: [10], coverage: complete(2) });
	});

	test('retains bounded recent activity only for known media/audio state while probing current truth', async () => {
		const now = 1_000_000;
		const { sendMessage } = installChrome([
			tab(20),
			tab(21),
			tab(22),
		], new Map([
			[22, 'media'],
		]));
		recordMediaState(20, 'document-20', { hasMediaElement: true, userInteracted: false, reportRevision: 1 });
		markTabActivated(20, now - 1_000);
		markTabAudible(21, true, now - 2_000);
		markTabAudible(21, false, now - 500);

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [20, 21, 22], coverage: complete(3) });
		// Recent media/audio evidence is already admitted and does not pay a probe.
		expect(sendMessage.mock.calls.map(([request]) => request.target.tabId)).toEqual([22]);
	});

	test('does not create or retain a recent media lease for an activated non-media tab', async () => {
		const now = 1_000_000;
		installChrome([tab(23, { active: true })], new Map([[23, 'empty']]));
		markTabActivated(23, now - 1_000);
		expect(tabAudioStates.has(23)).toBe(false);
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [], coverage: complete(1) });

		recordMediaState(23, 'document-23', { hasMediaElement: false, userInteracted: true, reportRevision: 1 });
		markTabActivated(23, now - 500);
		expect(tabAudioStates.get(23)?.lastActivatedTime).toBe(now - 500);
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [], coverage: complete(1) });
	});

	test('never revives a removed tab from a stale recent media row', async () => {
		const now = 1_000_000;
		installChrome([tab(25)], new Map([[25, 'empty']]));
		recordMediaState(24, 'document-24', { hasMediaElement: true, userInteracted: false, reportRevision: 1 });
		markTabActivated(24, now - 1_000);
		expect(tabAudioStates.has(24)).toBe(true);

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [], coverage: complete(1) });
		expect(tabAudioStates.has(24)).toBe(false);
	});

	test('keeps an expired-telemetry media tab visible through its durable reported fact without probing', async () => {
		const now = 1_000_000;
		const { sendMessage } = installChrome([tab(30)], new Map([[30, 'empty']]));
		recordMediaState(30, 'document-30', { hasMediaElement: true, userInteracted: true, reportRevision: 1 });
		captureStates.set(30, true);
		const state = tabAudioStates.get(30);
		if (!state) throw new Error('expected tab state');
		state.lastActivatedTime = now - TAB_VISIBLE_THRESHOLD_MS - 1;

		// 内容上报固化的 found 事实是权威媒体租约：过期遥测只清理 recent-activity
		// 状态行，媒体清单仍复用事实（不重探测），覆盖度保持 complete。
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [30], coverage: complete(1) });
		expect(tabAudioStates.has(30)).toBe(false);
		expect(sendMessage.mock.calls).toHaveLength(0);

		// 媒体移除上报（no-media 事实）是唯一剪枝信号：同一 documentId 的
		// 上报立即替换事实，清单随之清空。
		recordMediaState(30, 'document-30', { hasMediaElement: false, userInteracted: true, reportRevision: 2 });
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [], coverage: complete(1) });
	});

	test('isolates probe failures and never turns an unreachable document into a card', async () => {
		installChrome([
			tab(40),
			tab(41),
			tab(42),
		], new Map([
			[40, 'throw'],
			[41, 'invalid'],
			[42, 'media'],
		]));

		expect(await resolveVisibleTabs()).toMatchObject({ tabs: [42], coverage: { status: 'degraded', examined: 1, denied: 1, unknown: 1 } });
	});

	test('rejects a delayed positive media response after the tab navigates to a different document', async () => {
		const { sendMessage, getFrame } = installChrome(
			[tab(60)],
			new Map([[60, 'media']]),
			(_tabId, readIndex) => readIndex === 0 ? 'document-old' : 'document-new',
		);

		expect(await resolveVisibleTabs()).toMatchObject({ tabs: [], coverage: { status: 'degraded', stale: 1 } });
		expect(sendMessage.mock.calls).toHaveLength(1);
		expect(sendMessage.mock.calls[0]?.[0].target).toEqual({ tabId: 60, allFrames: true });
		expect(getFrame.mock.calls).toHaveLength(2);
	});

	test('fails closed before messaging when the top-frame document identity is unavailable', async () => {
		const { sendMessage } = installChrome(
			[tab(61)],
			new Map([[61, 'media']]),
			() => null,
		);

		expect(await resolveVisibleTabs()).toMatchObject({ tabs: [], coverage: { status: 'degraded', stale: 1 } });
		expect(sendMessage.mock.calls).toHaveLength(0);
	});

	test('bounds Popup-triggered media probes to eight concurrent documents', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const tabs = Array.from({ length: 25 }, (_, index) => tab(100 + index));
		installChrome(tabs, async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight -= 1;
			return 'media';
		});

		const result = await resolveVisibleTabs();
		expect(result.tabs).toEqual(tabs.map((item) => item.id));
		expect(maxInFlight).toBeLessThanOrEqual(8);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	test('ignores a never-audible false Chrome update', () => {
		markTabAudible(50, false, 10);
		expect(tabAudioStates.has(50)).toBe(false);
	});
});

type ProbeResult = 'media' | 'empty' | 'invalid' | 'throw';
type ProbeResolver = Map<number, ProbeResult> | ((tabId: number) => ProbeResult | Promise<ProbeResult>);
type DocumentResolver = (tabId: number, readIndex: number) => string | null | Promise<string | null>;

function tab(
	id: number,
	overrides: { active?: boolean; audible?: boolean; url?: string; windowId?: number } = {},
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
		discarded: false,
		autoDiscardable: true,
		groupId: -1,
		audible: overrides.audible ?? false,
		url: overrides.url ?? `https://example-${id}.test/watch`,
	};
}

function installChrome(
	tabs: chrome.tabs.Tab[],
	resolver: ProbeResolver,
	documentResolver: DocumentResolver = (tabId) => `document-${tabId}`,
) {
	const query = mock(async () => tabs);
	const documentReads = new Map<number, number>();
	const getAllFrames = mock(async ({ tabId }: { tabId: number }) => {
		const readIndex = documentReads.get(tabId) ?? 0;
		documentReads.set(tabId, readIndex + 1);
		const documentId = await documentResolver(tabId, readIndex);
		return documentId ? [{ frameId: 0, documentId }] : [];
	});
	const sendMessage = mock(async ({ target }: { target: { tabId: number } }) => {
		const tabId = target.tabId;
		const outcome = resolver instanceof Map
			? resolver.get(tabId) ?? 'empty'
			: await resolver(tabId);
		if (outcome === 'throw') throw new Error('receiver unavailable');
		if (outcome === 'invalid') return [{ frameId: 0, documentId: `document-${tabId}` }];
		return [{ frameId: 0, documentId: `document-${tabId}`, result: outcome === 'media' }];
	});
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			tabs: { query },
			webNavigation: { getAllFrames },
			scripting: { executeScript: sendMessage },
		},
	});
	return { sendMessage, getFrame: getAllFrames };
}
