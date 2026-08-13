import { afterEach, describe, expect, test } from 'bun:test';
import {
	createAntiHotlinkRules,
	isExactAntiHotlinkRuleSet,
	reconcileAntiHotlinkRules,
} from '../src/tools/hover-zoom/logic/engine';
import { parseHoverZoomSettings } from '../src/tools/hover-zoom/settings';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

function installDnr(initial: chrome.declarativeNetRequest.Rule[], rejectUpdate = false) {
	let rules = structuredClone(initial);
	let updates = 0;
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			declarativeNetRequest: {
				getDynamicRules: async () => structuredClone(rules),
				updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
					updates += 1;
					if (rejectUpdate) throw new Error('dnr unavailable');
					rules = rules.filter((rule) => !removeRuleIds.includes(rule.id));
					rules.push(...structuredClone(addRules));
				},
			},
		},
	});
	return { rules: () => rules, updates: () => updates };
}

describe('Hover Zoom DNR authority', () => {
	test('completes nested settings from one parser', () => {
		const settings = parseHoverZoomSettings({
			enabled: false,
			resourceKeys: { imageKey: { alt: false } },
		});
		expect(settings.enabled).toBe(false);
		expect(settings.resourceKeys.imageKey.alt).toBe(false);
		expect(settings.resourceKeys.imageKey.ctrl).toBe(false);
		expect(settings.resourceKeys.videoKey.alt).toBe(true);
	});

	test('fails closed on malformed activation fields and rejects malformed collections', () => {
		const settings = parseHoverZoomSettings({
			enabled: 'false',
			antiHotlink: 1,
			triggerKey: 'meta',
			siteBlacklist: [42],
			resourceKeys: { imageKey: { alt: 'yes' } },
		});
		expect(settings.enabled).toBe(false);
		expect(settings.antiHotlink).toBe(false);
		expect(settings.triggerKey).toBe('none');
		expect(settings.siteBlacklist).toEqual([]);
		expect(settings.resourceKeys.imageKey.alt).toBe(true);
	});

	test('repairs a partial physical rule set and verifies exact readback', async () => {
		const expected = createAntiHotlinkRules();
		const dnr = installDnr([expected[0] as chrome.declarativeNetRequest.Rule]);
		expect(isExactAntiHotlinkRuleSet(dnr.rules())).toBe(false);
		const receipt = await reconcileAntiHotlinkRules(true);
		expect(receipt).toEqual({ desired: true, active: true, changed: true });
		expect(dnr.updates()).toBe(1);
		expect(isExactAntiHotlinkRuleSet(dnr.rules())).toBe(true);
	});

	test('rejects an owned rule with any extra condition', () => {
		const rules = createAntiHotlinkRules();
		const changed = structuredClone(rules);
		if (changed[0]) changed[0].condition.requestMethods = ['get'];
		expect(isExactAntiHotlinkRuleSet(changed)).toBe(false);
	});

	test('removes all owned rules when disabled', async () => {
		const foreign = { ...createAntiHotlinkRules()[0], id: 50_000 } as chrome.declarativeNetRequest.Rule;
		const dnr = installDnr([...createAntiHotlinkRules(), foreign]);
		expect(await reconcileAntiHotlinkRules(false)).toEqual({
			desired: false,
			active: false,
			changed: true,
		});
		expect(dnr.rules()).toEqual([foreign]);
	});

	test('reports a physical API failure instead of optimistic activation', async () => {
		installDnr([], true);
		const receipt = await reconcileAntiHotlinkRules(true);
		expect(receipt.desired).toBe(true);
		expect(receipt.active).toBe(false);
		expect(receipt.error).toContain('dnr unavailable');
	});
});
