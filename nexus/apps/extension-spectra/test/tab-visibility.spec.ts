import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	captureStates,
	markTabActivated,
	markTabAudible,
	tabAudioStates,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../src/background/state';
import { recordMediaState, resolveVisibleTabs } from '../src/background/handlers/tab-state';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	tabAudioStates.clear();
	captureStates.clear();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('complete visible media tab lifecycle', () => {
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

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [2, 3] });
		expect(sendMessage.mock.calls.map(([tabId]) => tabId).sort((a, b) => Number(a) - Number(b)))
			.toEqual([1, 3, 4]);
		expect(sendMessage.mock.calls.every(([, , options]) => (
		typeof options?.documentId === 'string' && options.documentId.startsWith('document-')
	))).toBe(true);
	});

	test('never admits ordinary active tabs from another window without media truth', async () => {
		const { sendMessage } = installChrome([
			tab(6, { active: true, windowId: 1 }),
			tab(7, { active: true, windowId: 2 }),
		], new Map([
			[6, 'empty'],
			[7, 'empty'],
		]));

		expect(await resolveVisibleTabs()).toEqual({ tabs: [] });
		expect(sendMessage.mock.calls.map(([tabId]) => tabId).sort((a, b) => Number(a) - Number(b)))
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
		expect(await resolveVisibleTabs()).toEqual({ tabs: [10] });
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
		recordMediaState(20, { hasMediaElement: true, userInteracted: false });
		markTabActivated(20, now - 1_000);
		markTabAudible(21, true, now - 2_000);
		markTabAudible(21, false, now - 500);

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [20, 21, 22] });
		// Recent media/audio evidence is already admitted and does not pay a probe.
		expect(sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([22]);
	});

	test('does not create or retain a recent media lease for an activated non-media tab', async () => {
		const now = 1_000_000;
		installChrome([tab(23, { active: true })], new Map([[23, 'empty']]));
		markTabActivated(23, now - 1_000);
		expect(tabAudioStates.has(23)).toBe(false);
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [] });

		recordMediaState(23, { hasMediaElement: false, userInteracted: true });
		markTabActivated(23, now - 500);
		expect(tabAudioStates.get(23)?.lastActivatedTime).toBe(now - 500);
		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [] });
	});

	test('never revives a removed tab from a stale recent media row', async () => {
		const now = 1_000_000;
		installChrome([tab(25)], new Map([[25, 'empty']]));
		recordMediaState(24, { hasMediaElement: true, userInteracted: false });
		markTabActivated(24, now - 1_000);
		expect(tabAudioStates.has(24)).toBe(true);

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [] });
		expect(tabAudioStates.has(24)).toBe(false);
	});

	test('prunes expired telemetry instead of treating media reports as durable leases', async () => {
		const now = 1_000_000;
		installChrome([tab(30)], new Map([[30, 'empty']]));
		recordMediaState(30, { hasMediaElement: true, userInteracted: true });
		captureStates.set(30, true);
		const state = tabAudioStates.get(30);
		if (!state) throw new Error('expected tab state');
		state.lastActivatedTime = now - TAB_VISIBLE_THRESHOLD_MS - 1;

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [] });
		expect(tabAudioStates.has(30)).toBe(false);
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

		expect(await resolveVisibleTabs()).toEqual({ tabs: [42] });
	});

	test('rejects a delayed positive media response after the tab navigates to a different document', async () => {
		const { sendMessage, getFrame } = installChrome(
			[tab(60)],
			new Map([[60, 'media']]),
			(_tabId, readIndex) => readIndex === 0 ? 'document-old' : 'document-new',
		);

		expect(await resolveVisibleTabs()).toEqual({ tabs: [] });
		expect(sendMessage.mock.calls).toHaveLength(1);
		expect(sendMessage.mock.calls[0]?.[2]).toEqual({ documentId: 'document-old' });
		expect(getFrame.mock.calls).toHaveLength(2);
	});

	test('fails closed before messaging when the top-frame document identity is unavailable', async () => {
		const { sendMessage } = installChrome(
			[tab(61)],
			new Map([[61, 'media']]),
			() => null,
		);

		expect(await resolveVisibleTabs()).toEqual({ tabs: [] });
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
	const getFrame = mock(async ({ tabId, frameId }: { tabId: number; frameId: number }) => {
		if (frameId !== 0) throw new Error(`unexpected frame ${frameId}`);
		const readIndex = documentReads.get(tabId) ?? 0;
		documentReads.set(tabId, readIndex + 1);
		const documentId = await documentResolver(tabId, readIndex);
		return documentId ? { documentId } : null;
	});
	const sendMessage = mock(async (
		tabId: number,
		message: unknown,
		options?: { documentId?: string },
	) => {
		if (!message || typeof message !== 'object'
			|| (message as { type?: unknown }).type !== 'spectra.control.actual.read') {
			throw new Error('unexpected probe message');
		}
		if (options?.documentId !== `document-${tabId}`
			&& !options?.documentId?.startsWith('document-')) {
			throw new Error(`probe was not bound to a document: ${String(options?.documentId)}`);
		}
		const outcome = resolver instanceof Map
			? resolver.get(tabId) ?? 'empty'
			: await resolver(tabId);
		if (outcome === 'throw') throw new Error('receiver unavailable');
		if (outcome === 'invalid') return { ok: true, data: { unexpected: true } };
		if (outcome === 'empty') {
			return {
				ok: false,
				error: {
					code: 'capability-unavailable',
					message: 'No observable native media state',
					retryable: false,
				},
			};
		}
		return {
			ok: true,
			data: {
				target: null,
				patch: { playing: false },
				observedStrategies: { playing: 'dom-native' },
			},
		};
	});
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			tabs: { query, sendMessage },
			webNavigation: { getFrame },
		},
	});
	return { sendMessage, getFrame };
}
