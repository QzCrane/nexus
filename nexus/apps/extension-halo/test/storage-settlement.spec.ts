import { afterEach, describe, expect, test } from 'bun:test';
import { safeStorageGet, safeStorageSet, safeStorageRemove, scheduleStorageSet } from '../../../packages/nexus-kernel/src/storage/safe-storage';
import { INITIAL_TIMER_STATE, normalizeTimerState } from '../src/tools/timer/core';
import { createInitialState, normalizePomodoroState, normalizePomodoroConfig } from '../src/tools/pomodoro/core';
import { normalizeUnschematizedToolState, UseToolStatePendingAuthority } from '../src/kernel/hooks/use-tool-state';
import { saveToClipboardHistory } from '../src/tools/clipboard/core';
import { STORAGE_KEY, MAX_HISTORY } from '../src/tools/clipboard/types';
import { reportStorageHealth, storageProblemCount, subscribeStorageHealth, retryStorageProblems } from '../src/kernel/core/storage-health';
const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
afterEach(() => { if (previous) Object.defineProperty(globalThis, 'chrome', previous); else Reflect.deleteProperty(globalThis, 'chrome'); });
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
function install(storage: object) { Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local: storage } } }); }
describe('storage physical settlement and failed hydration', () => {
	test('an expired old write cannot overtake its queued successor', async () => {
		let release: (() => void) | undefined; const calls: unknown[] = []; let state: unknown;
		install({ set: async (data: unknown) => { calls.push(data); if (calls.length === 1) await new Promise<void>((done) => { release = done; }); state = data; } });
		const old = scheduleStorageSet({ value: 'old' }); expect(await old.observe(5)).toBe('unknown');
		const latest = scheduleStorageSet({ value: 'new' }); await pause(); expect(calls).toEqual([{ value: 'old' }]);
		release?.(); expect(await old.completion).toBe(true); expect(await latest.completion).toBe(true);
		expect(state).toEqual({ value: 'new' }); expect(await latest.observe()).toBe('committed');
	});
	test('queued snapshots are immutable and deletion shares the physical lane', async () => {
		let release: (() => void) | undefined; const calls: unknown[] = [];
		install({ set: async (data: unknown) => { calls.push(data); if (calls.length === 1) await new Promise<void>((done) => { release = done; }); }, remove: async (keys: unknown) => { calls.push(keys); } });
		const first = scheduleStorageSet({ value: 1 }); const data = { nested: { value: 2 } };
		const second = scheduleStorageSet(data); data.nested.value = 3; const deletion = safeStorageRemove('nested');
		await pause(); expect(calls).toEqual([{ value: 1 }]); release?.();
		await Promise.all([first.completion, second.completion]); expect(await deletion).toBe(true);
		expect(calls).toEqual([{ value: 1 }, { nested: { value: 2 } }, 'nested']);
	});
	test('does not retry an unfinished write or pretend uncertain writes committed', async () => {
		let calls = 0; install({ set: () => { calls++; return new Promise<void>(() => undefined); } });
		expect(await safeStorageSet({ value: 'pending' }, { timeout: 5, retries: 3 })).toBe(false);
		for (let i = 0; i < 63; i++) scheduleStorageSet({ value: i });
		expect(await scheduleStorageSet({ value: 'overflow' }).observe()).toBe('rejected'); expect(calls).toBe(1);
	});
	test('reads default only when absent; unavailable, failed and expired reads reject', async () => {
		install({ get: async () => ({}) }); expect(await safeStorageGet(['value'], { value: 7 })).toEqual({ value: 7 });
		install({ get: async () => { throw new Error('Quota backend unavailable'); } });
		await expect(safeStorageGet(['value'], { value: 7 })).rejects.toThrow('Quota backend unavailable');
		install({ get: () => new Promise(() => undefined) });
		await expect(safeStorageGet(['value'], { value: 7 }, { timeout: 5 })).rejects.toThrow('deadline');
		Reflect.deleteProperty(globalThis, 'chrome'); await expect(safeStorageGet(['value'], { value: 7 })).rejects.toThrow('unavailable');
	});
	test('a rejected physical operation releases its successor without infinite retries', async () => {
		let calls = 0; install({ set: async () => { if (++calls === 1) throw new Error('rejected'); } });
		const first = scheduleStorageSet({ value: 1 }); const second = scheduleStorageSet({ value: 2 });
		expect(await first.completion).toBe(false); expect(await second.completion).toBe(true); expect(calls).toBe(2);
	});
	test('failed hydration cannot accept a retry over a changed draft', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'fallback' }); authority.stageLocal({ value: 'draft' });
		expect(authority.acceptLoaded({ value: 'stored' }, 0)).toBe(false); authority.flushPending();
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'draft' });
	});
	test('reports retryable uncertainty without retaining retired owners', () => {
		const owner = Symbol(); let notifications = 0; let retries = 0; const count = storageProblemCount();
		const dispose = subscribeStorageHealth(() => { notifications++; }); reportStorageHealth(owner, 'write-error', () => { retries++; });
		expect(storageProblemCount()).toBe(count + 1); retryStorageProblems(); expect(retries).toBe(1);
		reportStorageHealth(owner, null); dispose(); expect(notifications).toBe(2); expect(storageProblemCount()).toBe(count);
	});
});
describe('JSON-safe timer and pinned history boundaries', () => {
	test('timer initial, running and paused states survive strict JSON storage', () => {
		const initial = normalizeTimerState(INITIAL_TIMER_STATE); expect(normalizeUnschematizedToolState(initial, initial)).toEqual(initial);
		const legacy = { ...initial, isRunning: true, startedAt: undefined }; expect(normalizeTimerState(legacy).startedAt).toBeNull();
		const paused = normalizeTimerState({ ...legacy, isRunning: false, elapsed: 420 });
		expect(JSON.parse(JSON.stringify(paused))).toEqual(paused); expect(paused.isRunning).toBe(false);
		for (const bad of [{ ...initial, elapsed: NaN }, { ...initial, laps: ['1'] }, { ...initial, mode: 'unknown' }]) expect(() => normalizeTimerState(bad)).toThrow();
	});
	test('Pomodoro pause and legacy deadlines encode as null, not lost transitions', () => {
		const initial = createInitialState(); const paused = normalizePomodoroState({ ...initial, remaining: 42, endsAt: undefined });
		expect(normalizeUnschematizedToolState(paused, initial)).toEqual(paused); expect(paused.endsAt).toBeNull();
		for (const bad of [{ ...initial, phase: 'missing' }, { ...initial, remaining: -1 }]) expect(() => normalizePomodoroState(bad)).toThrow();
		expect(() => normalizePomodoroConfig({ workMinutes: 0 })).toThrow();
	});
	test('never evicts pinned clipboard entries to admit ordinary text', async () => {
		let history = Array.from({ length: MAX_HISTORY }, (_, i) => ({ id: String(i), text: String(i), timestamp: i, pinned: true }));
		install({ get: async () => ({ [STORAGE_KEY]: history }), set: async (value: Record<string, typeof history>) => { history = value[STORAGE_KEY] ?? []; } });
		await expect(saveToClipboardHistory('new')).rejects.toThrow('pinned'); expect(history).toHaveLength(MAX_HISTORY);
		history[99] = { id: '99', text: '99', timestamp: 99, pinned: false }; const result = await saveToClipboardHistory('new');
		expect(result).toHaveLength(MAX_HISTORY); expect(result.filter((item) => item.pinned)).toHaveLength(99); expect(result.at(-1)?.text).toBe('new');
	});
});
