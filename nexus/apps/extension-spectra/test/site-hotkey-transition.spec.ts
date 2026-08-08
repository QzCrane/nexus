import { describe, expect, test } from 'bun:test';
import {
	reconcileSiteHotkeyTransition,
	type SiteHotkeyTransitionPort,
} from '../src/background/site-hotkey-transition';

function port(events: string[], failures: Set<string> = new Set()): SiteHotkeyTransitionPort {
	return {
		async barrier() {
			events.push('barrier');
			if (failures.has('barrier')) throw new Error('barrier failed');
		},
		async configureLean() {
			events.push('configure-lean');
			if (failures.has('lean')) throw new Error('lean failed');
		},
		async ensureFull(capability) {
			events.push(`ensure-full:${capability}`);
			if (failures.has('full')) throw new Error('full failed');
		},
		releaseFull(capability) {
			events.push(`release-full:${capability}`);
		},
	};
}

describe('exact site-hotkey ownership transition', () => {
	test('none empties lean first and then releases the obsolete full owner', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'none',
			previousFullCapability: 'site:example.com',
		}, port(events))).toBeNull();
		expect(events).toEqual(['barrier', 'release-full:site:example.com']);
	});

	test('full to lean empties lean state, releases heavy owner, then installs the new lean projection', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'lean',
			previousFullCapability: 'site:example.com',
		}, port(events))).toBeNull();
		expect(events).toEqual([
			'barrier',
			'release-full:site:example.com',
			'configure-lean',
		]);
	});

	test('lean to full keeps the host empty until the heavy runtime is ready', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'full',
			fullCapability: 'site:example.com',
		}, port(events))).toBe('site:example.com');
		expect(events).toEqual(['barrier', 'ensure-full:site:example.com']);
	});

	test('same full capability still barriers stale lean state without churning the heavy lease', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'full',
			previousFullCapability: 'site:example.com',
			fullCapability: 'site:example.com',
		}, port(events))).toBe('site:example.com');
		expect(events).toEqual(['barrier']);
	});

	test('changing full capability retires the old lease before acquiring the new one', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'full',
			previousFullCapability: 'site:old.example',
			fullCapability: 'site:new.example',
		}, port(events))).toBe('site:new.example');
		expect(events).toEqual([
			'barrier',
			'release-full:site:old.example',
			'ensure-full:site:new.example',
		]);
	});

	test('barrier failure changes no ownership', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyTransition({
			mode: 'lean',
			previousFullCapability: 'site:example.com',
		}, port(events, new Set(['barrier'])))).rejects.toThrow('barrier failed');
		expect(events).toEqual(['barrier']);
	});

	test('lean failure is visible and never falls back to full', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyTransition(
			{ mode: 'lean' },
			port(events, new Set(['lean'])),
		)).rejects.toThrow('lean failed');
		expect(events).toEqual(['barrier', 'configure-lean']);
		expect(events.some((event) => event.startsWith('ensure-full:'))).toBe(false);
	});

	test('full mode without capability fails after the exact empty barrier', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyTransition(
			{ mode: 'full' },
			port(events),
		)).rejects.toThrow('requires a capability identity');
		expect(events).toEqual(['barrier']);
	});
});
