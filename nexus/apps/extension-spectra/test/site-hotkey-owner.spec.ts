import { describe, expect, test } from 'bun:test';
import {
	SiteHotkeyDocumentOwner,
	type SiteHotkeyHostPort,
	type FullSiteHotkeyRuntimePort,
} from '../src/background/site-hotkey-owner';
import type { ResolvedSiteHotkeys } from '../src/shared/site-hotkey-mode';
import type { HotkeyBinding } from '@nexus/contracts';

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

function harness() {
	const events: string[] = [];
	const messages: Array<{ epoch: string; generation: number; bindings: unknown[] }> = [];
	const hostPort: SiteHotkeyHostPort = {
		async inject(tabId, documentId) {
			events.push(`inject:${tabId}:${documentId}`);
		},
		async configure(tabId, documentId, message) {
			events.push(`configure:${tabId}:${documentId}:${message.payload.bindings.length}`);
			messages.push(message.payload);
		},
	};
	const fullRuntime: FullSiteHotkeyRuntimePort = {
		async ensure(capability) { events.push(`ensure-full:${capability}`); },
		release(capability) { events.push(`release-full:${capability}`); },
	};
	return { owner: new SiteHotkeyDocumentOwner(hostPort), fullRuntime, events, messages };
}

describe('site hotkey document owner', () => {
	test('first lean reconcile barriers, injects once, then configures the exact projection', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0',
			'inject:7:doc-a',
			'configure:7:doc-a:1',
		]);
		expect(h.messages[0]?.bindings).toEqual([]);
		expect(h.messages[1]?.bindings).toHaveLength(1);
		expect(h.messages[1]?.generation).toBeGreaterThan(h.messages[0]?.generation ?? -1);
		expect(h.messages[1]?.epoch).toBe(h.messages[0]?.epoch);
	});

	test('later lean projection on the same document reuses the injected host', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		h.events.length = 0;
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0',
			'configure:7:doc-a:1',
		]);
	});

	test('lean to full empties the lean host before acquiring the heavy owner', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', lean(), h.fullRuntime);
		h.events.length = 0;
		await h.owner.reconcile(7, 'doc-a', full(), h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0',
			'ensure-full:site:example.com',
		]);
	});

	test('full to none barriers before releasing the full capability', async () => {
		const h = harness();
		await h.owner.reconcile(7, 'doc-a', full(), h.fullRuntime);
		h.events.length = 0;
		await h.owner.reconcile(7, 'doc-a', null, h.fullRuntime);
		expect(h.events).toEqual([
			'configure:7:doc-a:0',
			'release-full:site:example.com',
		]);
	});

	test('a new worker owner uses a new epoch so a surviving page host accepts its barrier', async () => {
		const h1 = harness();
		await h1.owner.reconcile(7, 'doc-a', lean(), h1.fullRuntime);
		const oldEpoch = h1.messages.at(-1)?.epoch;

		const h2 = harness();
		await h2.owner.reconcile(7, 'doc-a', null, h2.fullRuntime);
		const newEpoch = h2.messages[0]?.epoch;
		expect(newEpoch).toBeTruthy();
		expect(newEpoch).not.toBe(oldEpoch);
		expect(h2.messages[0]?.bindings).toEqual([]);
	});
});
