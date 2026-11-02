import { describe, expect, test } from 'bun:test';
import {
	acknowledgedProcessorLifecycle,
	hasKnownBackgroundRetentionInputs,
	readCachedCardSnapshot,
	readCardSnapshot,
	readInitialCardSnapshot,
	resolveInitialProcessorLifecycle,
	sessionBelongsToCard,
	writeCachedCardSnapshot,
} from '../src/popup/card/snapshot';

describe('field-level card snapshot coverage', () => {
	test('binds initial presentation without awaiting live RPC or reusing cached playing', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const tabId = 4_245;
		const documentId = 'doc-presentation';
		let messages = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			webNavigation: { getFrame: async () => ({ documentId }) },
			storage: { local: { get: async () => ({ [`spectra.control.tab.${tabId}`]: {
				tabId, documentId, origin: 'https://media.test', generation: 1, revision: 2, activeMedia: null, activeVideo: null,
				fields: { playing: { actual: true }, speed: { actual: 2 } },
			} }) } },
			runtime: { sendMessage: () => { messages += 1; return new Promise(() => undefined); } },
		} });
		try {
			const snapshot = await readInitialCardSnapshot(tabId);
			expect(snapshot?.controlSnapshot).toMatchObject({ state: 'known', value: { fields: { speed: { actual: 2 } } } });
			if (snapshot?.controlSnapshot.state === 'known') expect(snapshot.controlSnapshot.value?.fields.playing).toBeUndefined();
			expect(snapshot?.controlSnapshotFresh).toBe(false);
			expect(messages).toBe(0);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
	test.each([false, true])('confirms current playback before first paint despite durable or Popup cached ACK (cache: %s)', async (cached) => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const tabId = cached ? 4_244 : 4_243;
		const documentId = `doc-playback-${tabId}`;
		const oldControl = {
			tabId, documentId, origin: 'https://media.test', generation: 1, revision: 1, activeMedia: null, activeVideo: null,
			fields: { playing: { desired: true, actual: true, revision: 1, phase: 'applied', strategy: 'dom-native',
				coverage: 'active-target', controlled: true, lastError: null } },
		};
		const current = { ...oldControl, fields: { playing: { ...oldControl.fields.playing, desired: false, actual: false, controlled: false } } };
		const cache = { documentId, status: { state: 'unknown', reason: 'unavailable' },
			controlSnapshot: { state: 'known', value: oldControl }, sessionSnapshot: { state: 'known', value: null },
			isRemoteActive: { state: 'known', value: false } };
		const store: Record<string, unknown> = { [`spectra.control.tab.${tabId}`]: oldControl };
		if (cached) store[`spectra.popup.card_cache.${tabId}`] = { snapshot: cache };
		let reads = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			storage: { local: { get: async (input: string | string[]) => Object.fromEntries((Array.isArray(input) ? input : [input])
				.map((key) => [key, store[key]])), set: async () => undefined } },
			webNavigation: { getFrame: async () => ({ documentId }) },
			runtime: { sendMessage: async (message: { type: string }) => {
				if (message.type === 'spectra.control.snapshot.get') { reads += 1; return { ok: true, data: current }; }
				return { ok: true, data: { connected: false } };
			} },
			tabs: { sendMessage: async () => ({ ok: false, error: { code: 'unavailable', message: 'No runtime', retryable: false } }) },
		} });
		try {
			const result = await readCardSnapshot(tabId, { allowCached: cached });
			expect(result?.controlSnapshot).toMatchObject({ state: 'known', value: { fields: { playing: { actual: false } } } });
			expect(result?.controlSnapshotFresh).toBe(true);
			expect(reads).toBe(1);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
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

	test('a cached forecast never overrides the durable route the background owns', async () => {
		// The reported regression: a hijacked page reopened with a native-blue bar
		// because the card painted a cached `bypass` route while the durable
		// session already said capture. The cache is a copy; the durable record is
		// the owner, so the copy may never win.
		const tabId = 4_242;
		const documentId = 'doc-live';
		const bypassSession = {
			tabId, documentId, origin: 'https://live.test', generation: 1,
			desiredMode: 'bypass', actualMode: 'bypass', phase: 'idle',
			configRevision: 0, actualConfig: null, lastError: null,
		};
		const captureSession = { ...bypassSession, desiredMode: 'capture', actualMode: 'capture', phase: 'active' };
		const store: Record<string, unknown> = {
			[`spectra.popup.card_cache.${tabId}`]: {
				snapshot: {
					documentId,
					status: { state: 'unknown', reason: 'timeout' },
					controlSnapshot: { state: 'known', value: null },
					sessionSnapshot: { state: 'known', value: bypassSession },
					isRemoteActive: { state: 'unknown', reason: 'timeout' },
				},
			},
			[`spectra_audio_session_${tabId}`]: captureSession,
		};
		(globalThis as unknown as { chrome: unknown }).chrome = {
			storage: {
				local: {
					get: async (key: string | string[]) => {
						const keys = Array.isArray(key) ? key : [key];
						return Object.fromEntries(keys.filter((entry) => entry in store).map((entry) => [entry, store[entry]]));
					},
					set: async () => undefined,
					remove: async () => undefined,
				},
			},
		};

		const snapshot = await readCardSnapshot(tabId);
		expect(snapshot?.sessionSnapshot.state).toBe('known');
		expect(snapshot?.sessionSnapshot.state === 'known' && snapshot.sessionSnapshot.value?.actualMode)
			.toBe('capture');
	});
});
