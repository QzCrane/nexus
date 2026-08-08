import { describe, expect, test } from 'bun:test';
import type { HotkeyBinding } from '@nexus/contracts';
import {
	SiteHotkeyDocumentOwner,
	type FullSiteHotkeyRuntimePort,
	type SiteHotkeyHostPort,
} from '../src/background/site-hotkey-owner';
import type { ResolvedSiteHotkeys } from '../src/shared/site-hotkey-mode';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function binding(action: 'speed_up' | 'volume_mute' = 'speed_up'): HotkeyBinding {
	return {
		id: `binding-${action}`,
		enabled: true,
		key: {
			code: action === 'speed_up' ? 'KeyK' : 'KeyM',
			modifiers: { ctrl: true, alt: false, shift: false, meta: false },
		},
		action,
	};
}

function lean(domain = 'example.com'): ResolvedSiteHotkeys {
	return {
		domain,
		mode: 'lean',
		site: { enabled: true, bindings: [binding()] },
	};
}

function full(domain = 'example.com'): ResolvedSiteHotkeys {
	return {
		domain,
		mode: 'full',
		site: {
			enabled: true,
			bindings: [{ ...binding(), action: 'fullscreen_toggle' }],
		},
	};
}

function harness(options: { receiverPresent?: boolean } = {}) {
	const events: string[] = [];
	const messages: Array<{ epoch: string; generation: number; bindings: unknown[] }> = [];
	let receiverPresent = options.receiverPresent ?? false;
	let injectGate: ReturnType<typeof deferred> | null = null;
	let ensureGate: ReturnType<typeof deferred> | null = null;
	let onInjectStarted: (() => void) | null = null;
	let onEnsureStarted: (() => void) | null = null;

	const hostPort: SiteHotkeyHostPort = {
		async inject(tabId, documentId) {
			events.push(`inject:${tabId}:${documentId}`);
			onInjectStarted?.();
			if (injectGate) await injectGate.promise;
			receiverPresent = true;
		},
		async configure(tabId, documentId, message) {
			events.push(`configure:${tabId}:${documentId}:${message.payload.bindings.length}:${receiverPresent ? 'delivered' : 'absent'}`);
			messages.push(message.payload);
			return receiverPresent ? 'delivered' : 'absent';
		},
	};
	const fullRuntime: FullSiteHotkeyRuntimePort = {
		async ensure(capability) {
			events.push(`ensure-full:${capability}`);
			onEnsureStarted?.();
			if (ensureGate) await ensureGate.promise;
		},
		release(capability) { events.push(`release-full:${capability}`); },
	};
	return {
		owner: new SiteHotkeyDocumentOwner(hostPort),
		fullRuntime,
		events,
		messages,
		setInjectGate(gate: ReturnType<typeof deferred> | null) { injectGate = gate; },
		setEnsureGate(gate: ReturnType<typeof deferred> | null) { ensureGate = gate; },
		onInjectStart(callback: () => void) { onInjectStarted = callback; },
		onEnsureStart(callback: () => void) { onEnsureStarted = callback; },
	};
}

describe('site hotkey document owner', () => {
	test('first lean reconcile treats an absent receiver as empty, injects, then configures exactly once', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0:absent',
			'inject:7:doc-a',
			'configure:7:doc-a:1:delivered',
		]);
		expect(h.messages[0]?.bindings).toEqual([]);
		expect(h.messages[1]?.bindings).toHaveLength(1);
		expect(h.messages[1]?.generation).toBeGreaterThan(h.messages[0]?.generation ?? -1);
		expect(h.messages[1]?.epoch).toBe(h.messages[0]?.epoch);
	});

	test('fresh full mode does not require the lean host to exist', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', full(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0:absent',
			'ensure-full:site:example.com',
		]);
	});

	test('later lean projection reuses the injected host', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		h.events.length = 0;
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0:delivered',
			'configure:7:doc-a:1:delivered',
		]);
	});

	test('a new worker epoch can clear a surviving old-worker host', async () => {
		const h1 = harness();
		await h1.owner.reconcile(7, 'doc-a', lean(), h1.fullRuntime);
		const oldEpoch = h1.messages.at(-1)?.epoch;

		const h2 = harness({ receiverPresent: true });
		await h2.owner.reconcile(7, 'doc-a', null, h2.fullRuntime);
		const newEpoch = h2.messages[0]?.epoch;
		expect(newEpoch).toBeTruthy();
		expect(newEpoch).not.toBe(oldEpoch);
		expect(h2.messages[0]?.bindings).toEqual([]);
		expect(h2.events).toEqual(['configure:7:doc-a:0:delivered']);
	});

	test('forget during injection fences the stale nonempty projection', async () => {
		const h = harness();
		const injectGate = deferred();
		const injectStarted = deferred();
		h.setInjectGate(injectGate);
		h.onInjectStart(injectStarted.resolve);

		const stale = h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		await injectStarted.promise;
		h.owner.forget(7, 'doc-a');
		injectGate.resolve();
		await stale;

		expect(h.events).toEqual([
			'configure:7:doc-a:0:absent',
			'inject:7:doc-a',
		]);
		expect(h.events.some((event) => event.includes(':1:delivered'))).toBe(false);

		h.events.length = 0;
		h.setInjectGate(null);
		await h.owner.reconcile(7, 'doc-a', full(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0:delivered',
			'ensure-full:site:example.com',
		]);
	});

	test('forget during a slow full ensure releases the retired lease when ensure finally completes', async () => {
		const h = harness();
		const ensureGate = deferred();
		const ensureStarted = deferred();
		h.setEnsureGate(ensureGate);
		h.onEnsureStart(ensureStarted.resolve);

		const stale = h.owner.reconcile(7, 'doc-a', full(), h.fullRuntime);
		await ensureStarted.promise;
		h.owner.forget(7, 'doc-a');
		ensureGate.resolve();
		await stale;
		expect(h.events).toEqual([
			'configure:7:doc-a:0:absent',
			'ensure-full:site:example.com',
			'release-full:site:example.com',
		]);
	});
});
