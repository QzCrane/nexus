import { describe, expect, test } from 'bun:test';
import { projectMediaCardMembership, type MediaCardEvidence } from '../src/shared/media-card-policy';

const now = 1_000_000;
const tab = (id: number, changes: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({ id, url: `https://media.test/${id}`, discarded: false, frozen: false, status: 'complete', ...changes } as chrome.tabs.Tab);
const fact = (changes: Partial<MediaCardEvidence> = {}): MediaCardEvidence => ({ documentId: 'doc', outcome: 'found', playing: false, userInteracted: true, usedAt: now - 1_000, pausedAt: now - 1_000, ...changes });

describe('dynamic media card membership', () => {
	test('renders every eligible background member without a display quota', () => {
		const tabs = Array.from({ length: 27 }, (_, index) => tab(index + 1));
		expect(projectMediaCardMembership(tabs, () => fact(), 60, now).tabs).toEqual(tabs.map(({ id }) => id));
	});
	test('ignores unopened unloaded tabs without even inventing inactive media', () => {
		const tabs = Array.from({ length: 48 }, (_, index) => tab(index + 1, { status: 'unloaded', discarded: true }));
		expect(projectMediaCardMembership(tabs, () => null, 60, now)).toEqual({ tabs: [], inactiveTabs: [] });
	});
	test('moves old paused media to inactive without removing fresh sleeping or muted playing media', () => {
		const facts = new Map([[1, fact({ pausedAt: now - 61_000, usedAt: now - 62_000 })], [2, fact()], [3, fact({ playing: true, pausedAt: null, usedAt: now - 80_000 })]]);
		expect(projectMediaCardMembership([tab(1), tab(2, { frozen: true }), tab(3, { audible: false })], (id) => facts.get(id) ?? null, 60, now))
			.toEqual({ tabs: [2, 3], inactiveTabs: [1], nextExpiryAt: now + 59_000, expiryByTab: { '2': now + 59_000 } });
	});
	test('metadata without use is not a recent card and 0 never expires used media', () => {
		expect(projectMediaCardMembership([tab(1)], () => fact({ userInteracted: false, usedAt: undefined }), 60, now)).toEqual({ tabs: [], inactiveTabs: [1] });
		expect(projectMediaCardMembership([tab(1, { frozen: true })], () => fact({ pausedAt: 1 }), 0, now).tabs).toEqual([1]);
	});
	test('uses unavailable time without calling a frozen document paused or playing', () => {
		expect(projectMediaCardMembership([tab(1, { frozen: true })], () => fact({ playing: true, pausedAt: null, usedAt: 1, unavailableAt: now - 2_000 }), 60, now).tabs).toEqual([1]);
	});
	test('a real visit renews recent eligibility without changing the physical pause time', () => {
		const paused = fact({ pausedAt: now - 100_000, usedAt: now });
		expect(projectMediaCardMembership([tab(1)], () => paused, 60, now).tabs).toEqual([1]);
		expect(paused.pausedAt).toBe(now - 100_000);
	});
});
