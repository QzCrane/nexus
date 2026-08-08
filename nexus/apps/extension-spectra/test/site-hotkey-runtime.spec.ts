import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_HOTKEY_SETTINGS,
	type HotkeyAction,
	type HotkeyBinding,
	type HotkeySettings,
} from '@nexus/contracts';
import { resolveSiteHotkeys } from '../src/shared/site-hotkey-mode';
import {
	createLeanSiteHotkeyInjector,
	reconcileSiteHotkeyRuntime,
	siteHotkeyRuntimeTestApi,
} from '../src/background/site-hotkey-runtime';

const runtimeSource = readFileSync(
	new URL('../src/background/site-hotkey-runtime.ts', import.meta.url),
	'utf8',
);

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function binding(action: HotkeyAction): HotkeyBinding {
	return {
		id: `binding-${action}`,
		key: {
			code: 'KeyK',
			modifiers: { ctrl: false, alt: false, shift: false, meta: false },
		},
		action,
		enabled: true,
	};
}

function settings(action: HotkeyAction): HotkeySettings {
	return {
		...structuredClone(DEFAULT_HOTKEY_SETTINGS),
		sites: {
			'example.com': {
				enabled: true,
				bindings: [binding(action)],
			},
		},
	};
}

describe('lean custom-site hotkey injector', () => {
	test('coalesces one exact-document injection and caches only successful completion', async () => {
		const gate = deferred();
		const calls: Array<[number, string, string]> = [];
		const injector = createLeanSiteHotkeyInjector({
			execute: async (tabId, documentId, file) => {
				calls.push([tabId, documentId, file]);
				await gate.promise;
			},
		});

		const first = injector.ensure(7, 'doc-a');
		const second = injector.ensure(7, 'doc-a');
		expect(first).toBe(second);
		expect(calls).toEqual([[7, 'doc-a', siteHotkeyRuntimeTestApi.LEAN_SITE_HOTKEY_FILE]]);
		expect(injector.isInjected(7, 'doc-a')).toBe(false);

		gate.resolve();
		await first;
		expect(injector.isInjected(7, 'doc-a')).toBe(true);
		await injector.ensure(7, 'doc-a');
		expect(calls).toHaveLength(1);
	});

	test('does not cache a failed injection and retries on the next explicit ensure', async () => {
		let attempts = 0;
		const injector = createLeanSiteHotkeyInjector({
			execute: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('transient injection failure');
			},
		});

		await expect(injector.ensure(8, 'doc-b')).rejects.toThrow('transient injection failure');
		expect(injector.isInjected(8, 'doc-b')).toBe(false);
		await injector.ensure(8, 'doc-b');
		expect(attempts).toBe(2);
		expect(injector.isInjected(8, 'doc-b')).toBe(true);
	});

	test('forget fences a stale in-flight completion and permits a fresh document attempt', async () => {
		const firstGate = deferred();
		const secondGate = deferred();
		let attempts = 0;
		const injector = createLeanSiteHotkeyInjector({
			execute: async () => {
				attempts += 1;
				await (attempts === 1 ? firstGate.promise : secondGate.promise);
			},
		});

		const stale = injector.ensure(9, 'doc-c');
		injector.forget(9, 'doc-c');
		const fresh = injector.ensure(9, 'doc-c');
		expect(attempts).toBe(2);

		firstGate.resolve();
		await stale;
		expect(injector.isInjected(9, 'doc-c')).toBe(false);

		secondGate.resolve();
		await fresh;
		expect(injector.isInjected(9, 'doc-c')).toBe(true);
	});

	test('tab forget and reset retire cached documents without cross-tab damage', async () => {
		const injector = createLeanSiteHotkeyInjector({ execute: async () => undefined });
		await injector.ensure(10, 'doc-a');
		await injector.ensure(10, 'doc-b');
		await injector.ensure(11, 'doc-c');

		injector.forget(10);
		expect(injector.isInjected(10, 'doc-a')).toBe(false);
		expect(injector.isInjected(10, 'doc-b')).toBe(false);
		expect(injector.isInjected(11, 'doc-c')).toBe(true);

		injector.reset();
		expect(injector.isInjected(11, 'doc-c')).toBe(false);
	});

	test('production port pins injection to one document in the isolated world', () => {
		expect(runtimeSource).toContain('target: { tabId, documentIds: [documentId] }');
		expect(runtimeSource).toContain("world: 'ISOLATED'");
		expect(runtimeSource).toContain('injectImmediately: true');
		expect(runtimeSource).not.toContain('frameIds:');
	});
});

describe('custom-site hotkey runtime transition', () => {
	const lean = resolveSiteHotkeys('https://example.com/a', settings('speed_up'));
	const full = resolveSiteHotkeys('https://example.com/a', settings('fullscreen_toggle'));

	test('lean mode owns zero full-runtime hotkey leases', async () => {
		const events: string[] = [];
		const result = await reconcileSiteHotkeyRuntime(undefined, lean, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(result).toBeNull();
		expect(events).toEqual(['ensure-lean']);
	});

	test('full mode preserves one stable document-lifetime capability', async () => {
		const events: string[] = [];
		const created = await reconcileSiteHotkeyRuntime(undefined, full, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(created).toBe('site:example.com');
		expect(events).toEqual(['ensure-full:site:example.com']);

		events.length = 0;
		const retained = await reconcileSiteHotkeyRuntime(created ?? undefined, full, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(retained).toBe('site:example.com');
		expect(events).toEqual([]);
	});

	test('full to lean releases the obsolete heavy lease before lean injection', async () => {
		const events: string[] = [];
		const result = await reconcileSiteHotkeyRuntime('site:example.com', lean, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(result).toBeNull();
		expect(events).toEqual(['release-full:site:example.com', 'ensure-lean']);
	});

	test('lean to full creates the original heavy lease and none releases it', async () => {
		const events: string[] = [];
		const fullCapability = await reconcileSiteHotkeyRuntime(undefined, full, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(fullCapability).toBe('site:example.com');

		events.length = 0;
		const none = await reconcileSiteHotkeyRuntime(fullCapability ?? undefined, null, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => { events.push('ensure-lean'); },
		});
		expect(none).toBeNull();
		expect(events).toEqual(['release-full:site:example.com']);
	});

	test('lean injection failure fails closed and never falls back to full', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyRuntime(undefined, lean, {
			ensureFull: async (capability) => { events.push(`ensure-full:${capability}`); },
			releaseFull: (capability) => { events.push(`release-full:${capability}`); },
			ensureLean: async () => {
				events.push('ensure-lean');
				throw new Error('lean load failed');
			},
		})).rejects.toThrow('lean load failed');
		expect(events).toEqual(['ensure-lean']);
	});
});
