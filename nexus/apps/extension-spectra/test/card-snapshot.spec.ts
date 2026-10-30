import { describe, expect, test } from 'bun:test';
import {
	acknowledgedProcessorLifecycle,
	hasKnownBackgroundRetentionInputs,
	readCachedCardSnapshot,
	resolveInitialProcessorLifecycle,
	sessionBelongsToCard,
	writeCachedCardSnapshot,
} from '../src/popup/card/snapshot';

describe('field-level card snapshot coverage', () => {
	test.each(['capture', 'bypass'] as const)('uses the newer settled runtime %s before the first card paint', (mode) => {
		const runtime = { actualMode: mode, desiredMode: mode, phase: mode === 'capture' ? 'active' as const : 'idle' as const, generation: 6 };
		const oldMode = mode === 'capture' ? 'bypass' as const : 'capture' as const;
		const session = { actualMode: oldMode, desiredMode: oldMode, phase: oldMode === 'capture' ? 'active' as const : 'idle' as const, generation: 5 };
		expect(resolveInitialProcessorLifecycle(runtime, session)).toBe(runtime);
		expect(resolveInitialProcessorLifecycle(runtime, { ...session, generation: 6 })).toBe(runtime);
		const newerSession = { ...session, generation: 7 };
		expect(resolveInitialProcessorLifecycle(runtime, newerSession)).toBe(newerSession);
		expect(resolveInitialProcessorLifecycle(runtime, null)).toBe(runtime);
	});

	test.each(['starting', 'stopping', 'error'] as const)('does not present runtime %s as an acknowledged final color', (phase) => {
		const runtime = { actualMode: 'capture' as const, desiredMode: 'capture' as const, phase, generation: 6 };
		const session = { actualMode: 'bypass' as const, desiredMode: 'bypass' as const, phase: 'idle' as const, generation: 5 };
		expect(resolveInitialProcessorLifecycle(runtime, session)).toBe(session);
		expect(resolveInitialProcessorLifecycle(runtime, null)).toBeNull();
	});

	test('paints the route from the acknowledged control fields when no lifecycle read answers', () => {
		const acknowledged = {
			actualMode: 'capture' as const,
			desiredMode: 'capture' as const,
			phase: 'active' as const,
			generation: 4,
		};
		// 运行时与会话都没读到：卡片仍必须从控制快照自己的处理器 ACK 得到 capture。
		expect(resolveInitialProcessorLifecycle(null, null, acknowledged)).toBe(acknowledged);
		// 更旧的会话不能把已确认的路由改回 bypass。
		const staleSession = {
			actualMode: 'bypass' as const, desiredMode: 'bypass' as const, phase: 'idle' as const, generation: 3,
		};
		expect(resolveInitialProcessorLifecycle(null, staleSession, acknowledged)).toBe(acknowledged);
		// 更新的会话描述的是快照还没看到的交接，它优先。
		const newerSession = { ...staleSession, generation: 5 };
		expect(resolveInitialProcessorLifecycle(null, newerSession, acknowledged)).toBe(newerSession);
	});

	test('reads the acknowledged route from a control snapshot processor ACK', () => {
		const control = {
			generation: 7,
			fields: {
				boost: {
					desired: 3.5,
					actual: 3.5,
					revision: 3,
					phase: 'applied',
					strategy: 'capture',
					coverage: 'opaque',
					controlled: true,
					lastError: null,
				},
			},
		};
		expect(acknowledgedProcessorLifecycle(control as never)).toMatchObject({
			actualMode: 'capture',
			phase: 'active',
			generation: 7,
		});
		// 只有页面字段的快照没有处理器 ACK，不能凭它编造路由。
		expect(acknowledgedProcessorLifecycle({
			generation: 7,
			fields: {
				volumeBase: {
					desired: 100, actual: 100, revision: 3, phase: 'applied',
					strategy: 'page-native', coverage: 'active-target', controlled: false, lastError: null,
				},
			},
		} as never)).toBeNull();
		expect(acknowledgedProcessorLifecycle(null)).toBeNull();
	});

	test('fences a session by the card document while the control projection is silent', () => {
		const session = { tabId: 5, documentId: 'doc-a', origin: 'https://a.test' };
		expect(sessionBelongsToCard(session as never, null, 'doc-a')).toBe(true);
		expect(sessionBelongsToCard(session as never, null, 'doc-b')).toBe(false);
		expect(sessionBelongsToCard(session as never, null, '')).toBe(false);
		expect(sessionBelongsToCard(null, null, 'doc-a')).toBe(false);
		// 控制投影在场时由它作证：tab、document 与 origin 必须同时一致。
		expect(sessionBelongsToCard(
			session as never,
			{ tabId: 5, documentId: 'doc-a', origin: 'https://a.test' },
			'doc-a',
		)).toBe(true);
		expect(sessionBelongsToCard(
			session as never,
			{ tabId: 5, documentId: 'doc-b', origin: 'https://a.test' },
			'doc-a',
		)).toBe(false);
	});

	test('allows inactive-card eviction only when lifecycle and remote state are both known', () => {
		expect(hasKnownBackgroundRetentionInputs({
			status: { state: 'known', value: {} as never },
			isRemoteActive: { state: 'known', value: false },
		})).toBe(true);
		for (const snapshot of [
			{ status: { state: 'unknown', reason: 'timeout' }, isRemoteActive: { state: 'known', value: false } },
			{ status: { state: 'known', value: {} }, isRemoteActive: { state: 'unknown', reason: 'rejected' } },
		] as const) expect(hasKnownBackgroundRetentionInputs(snapshot as never)).toBe(false);
	});

	test('writes and reads cached card snapshot consistently with storage mock', async () => {
		const mockStorage: Record<string, unknown> = {};
		(globalThis as unknown as { chrome: unknown }).chrome = {
			storage: {
				local: {
					get: async (key: string) => ({ [key]: mockStorage[key] }),
					set: async (obj: Record<string, unknown>) => { Object.assign(mockStorage, obj); },
				},
			},
		};

		const dummySnapshot = {
			documentId: 'doc-123',
			status: { state: 'known' as const, value: null },
			controlSnapshot: { state: 'known' as const, value: null },
			sessionSnapshot: { state: 'known' as const, value: null },
			isRemoteActive: { state: 'known' as const, value: false },
		};

		writeCachedCardSnapshot(999, dummySnapshot);
		const cached = await readCachedCardSnapshot(999);
		expect(cached).not.toBeNull();
		expect(cached?.documentId).toBe('doc-123');
		expect(cached?.fromCache).toBe(true);
	});
});
