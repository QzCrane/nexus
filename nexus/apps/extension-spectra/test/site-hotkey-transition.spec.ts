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
		async suspendFull() {
			events.push('suspend-full');
			if (failures.has('suspend')) throw new Error('suspend failed');
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
	test('none empties lean, suspends any resident heavy listener, then releases obsolete full ownership', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'none',
			previousFullCapability: 'site:example.com',
		}, port(events))).toBeNull();
		expect(events).toEqual([
			'barrier',
			'suspend-full',
			'release-full:site:example.com',
		]);
	});

	test('full to lean suspends the heavy listener before releasing its lease and enabling lean', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'lean',
			previousFullCapability: 'site:example.com',
		}, port(events))).toBeNull();
		expect(events).toEqual([
			'barrier',
			'suspend-full',
			'release-full:site:example.com',
			'configure-lean',
		]);
	});

	test('fresh lean still suspends a surviving heavy listener not remembered by the new worker', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({ mode: 'lean' }, port(events))).toBeNull();
		expect(events).toEqual(['barrier', 'suspend-full', 'configure-lean']);
	});

	test('lean to full keeps the lean host empty until the heavy runtime is ready', async () => {
		const events: string[] = [];
		expect(await reconcileSiteHotkeyTransition({
			mode: 'full',
			fullCapability: 'site:example.com',
		}, port(events))).toBe('site:example.com');
		expect(events).toEqual(['barrier', 'ensure-full:site:example.com']);
	});

	test('same full capability barriers stale lean state without churning the heavy lease', async () => {
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

	test('heavy suspension failure retains the old full lease and never enables lean', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyTransition({
			mode: 'lean',
			previousFullCapability: 'site:example.com',
		}, port(events, new Set(['suspend'])))).rejects.toThrow('suspend failed');
		expect(events).toEqual(['barrier', 'suspend-full']);
	});

	test('lean failure is visible and never falls back to full', async () => {
		const events: string[] = [];
		await expect(reconcileSiteHotkeyTransition(
			{ mode: 'lean' },
			port(events, new Set(['lean'])),
		)).rejects.toThrow('lean failed');
		expect(events).toEqual(['barrier', 'suspend-full', 'configure-lean']);
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
