import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isTopLevelDocumentNavigation, setupLifecycleListeners } from '../src/background/lifecycle';
import { mediaFacts } from '../src/background/media-facts';
import { badgeState } from '../src/background/state';
import { resetPaintedBadgesForTests, updateBadgeFromControlProjection } from '../src/background/handlers/badge';
import { resetBadgeUsageForTests, hasBadgeUsage } from '../src/background/badge-usage';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

function testEvent<Args extends unknown[]>() {
	const listeners: Array<(...args: Args) => void> = [];
	return {
		addListener: (listener: (...args: Args) => void) => { listeners.push(listener); },
		emit: (...args: Args) => { for (const listener of listeners) listener(...args); },
	};
}

function lifecycleFixture() {
	const updated = testEvent<[number, chrome.tabs.TabChangeInfo, chrome.tabs.Tab]>();
	const activated = testEvent<[{ tabId: number; windowId: number }]>();
	const created = testEvent<[chrome.tabs.Tab]>();
	const removed = testEvent<[number]>();
	const values: Record<string, unknown> = {};
	Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
		runtime: { onSuspend: testEvent<[]>(), sendMessage: async () => undefined },
		tabs: { onActivated: activated, onUpdated: updated, onCreated: created, onRemoved: removed,
			query: async () => [], get: async (id: number) => ({ id, active: false }) },
		webNavigation: { onBeforeNavigate: testEvent<[]>(), onCommitted: testEvent<[]>(),
			onHistoryStateUpdated: testEvent<[]>(), onReferenceFragmentUpdated: testEvent<[]>() },
		storage: {
			session: { get: async (key: string) => ({ [key]: values[key] }), set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
				remove: async (key: string) => { delete values[key]; } },
			local: { remove: async () => undefined },
		},
	} });
	return { updated, activated, created, removed };
}

let fixture: ReturnType<typeof lifecycleFixture>;
beforeEach(async () => {
	fixture = lifecycleFixture();
	await mediaFacts.ready();
	setupLifecycleListeners();
});
afterEach(async () => {
	badgeState.clear();
	resetPaintedBadgesForTests();
	resetBadgeUsageForTests();
	mediaFacts.forgetMediaFact(9001);
	mediaFacts.forgetMediaFact(9002);
	await mediaFacts.flushMediaFacts();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

async function settleLifecycle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await mediaFacts.flushMediaFacts();
}

describe('background document lifecycle', () => {
	test('tab closure clears the badge decision and its paint cache before cleanup awaits', async () => {
		const texts: string[] = [];
		Object.assign(chrome, { action: {
			setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
			setBadgeBackgroundColor: async () => undefined,
			setBadgeTextColor: async () => undefined,
		} });
		const identity = { tabId: 9001, documentId: 'document-known', origin: 'https://media.example', generation: 4 };
		const projection = { volumeBase: 80, boost: 1, mediaMuted: false };
		await updateBadgeFromControlProjection(identity, projection, false, true, 9);
		fixture.removed.emit(9001);
		expect(badgeState.has(9001)).toBe(false);
		await settleLifecycle();
		await updateBadgeFromControlProjection(identity, projection, false, true, 1);
		expect(texts).toEqual(['80', '80']);
	});

	test('a created tab cannot inherit usage from a reused tabId', async () => {
		const texts: string[] = [];
		Object.assign(chrome, { action: {
			setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
			setBadgeBackgroundColor: async () => undefined,
			setBadgeTextColor: async () => undefined,
		} });
		const identity = { tabId: 9001, documentId: 'document-used', origin: 'https://media.example', generation: 4 };
		const projection = { volumeBase: 80, boost: 1, mediaMuted: false };
		await updateBadgeFromControlProjection(identity, projection, false, true, 1);
		expect(await hasBadgeUsage(9001)).toBe(true);
		expect(texts.at(-1)).toBe('80');
		badgeState.clear();
		// Chrome reuses the id for a brand-new tab; nothing about the old tab is
		// evidence that this one was ever touched (I10).
		fixture.created.emit({ id: 9001 } as chrome.tabs.Tab);
		await settleLifecycle();
		expect(await hasBadgeUsage(9001)).toBe(false);
		await updateBadgeFromControlProjection({ ...identity, documentId: 'document-new' }, projection, false, false, 1);
		expect(badgeState.has(9001)).toBe(false);
	});

	test('records activation of known media without creating a fact for an unknown tab', async () => {
		mediaFacts.rememberMediaFact(9001, 'document-known', 'found', 'report', 100, 4, { playing: true, usedAt: 1 });
		fixture.activated.emit({ tabId: 9001, windowId: 1 });
		fixture.activated.emit({ tabId: 9002, windowId: 1 });
		await settleLifecycle();
		expect(mediaFacts.readMediaFact(9001)).toMatchObject({ reportRevision: 4, at: 100, playing: true, pausedAt: null });
		expect(mediaFacts.readMediaFact(9001)?.usedAt).toBeGreaterThan(1);
		expect(mediaFacts.readMediaFact(9002)).toBeNull();
	});

	test.each(['frozen', 'discarded', 'unloaded'] as const)('records %s as availability without manufacturing pause and clears it on resume', async (availability) => {
		mediaFacts.rememberMediaFact(9001, 'document-known', 'found', 'report', 100, 4, { playing: true, usedAt: 50 });
		const tab = { id: 9001, url: 'https://media.example', status: availability === 'unloaded' ? 'unloaded' : 'complete',
			frozen: availability === 'frozen', discarded: availability === 'discarded' } as chrome.tabs.Tab;
		const change = availability === 'unloaded' ? { status: 'unloaded' as const } : { [availability]: true };
		fixture.updated.emit(9001, change, tab);
		fixture.updated.emit(9002, change, { ...tab, id: 9002 });
		await settleLifecycle();
		const unavailableAt = mediaFacts.readMediaFact(9001)?.unavailableAt;
		expect(unavailableAt).toBeGreaterThan(100);
		expect(mediaFacts.readMediaFact(9001)).toMatchObject({ playing: true, pausedAt: null, usedAt: 50, reportRevision: 4, at: 100 });
		expect(mediaFacts.readMediaFact(9002)).toBeNull();
		fixture.updated.emit(9001, change, tab);
		await settleLifecycle();
		expect(mediaFacts.readMediaFact(9001)?.unavailableAt).toBe(unavailableAt);
		const resume = availability === 'unloaded' ? { status: 'complete' as const } : { [availability]: false };
		fixture.updated.emit(9001, resume, { ...tab, frozen: false, discarded: false, status: 'complete' });
		await settleLifecycle();
		expect(mediaFacts.readMediaFact(9001)?.unavailableAt).toBeUndefined();
	});
	test('clears only top-level replacement navigations', () => {
		expect(isTopLevelDocumentNavigation({ frameId: 0 })).toBe(true);
		expect(isTopLevelDocumentNavigation({ frameId: 1 })).toBe(false);
		expect(isTopLevelDocumentNavigation({ frameId: 42 })).toBe(false);
	});
});
