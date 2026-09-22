import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HOTKEY_SETTINGS,
	isSpectraDefaultHotkeyTriggerPayload,
	type HotkeyAction,
	type HotkeyBinding,
	type HotkeySettings,
} from '@nexus/contracts';
import {
	isLeanRepeatableSiteHotkeyAction,
	resolveSiteHotkeys,
} from '../src/shared/site-hotkey-mode';

function binding(
	action: HotkeyAction,
	overrides: Partial<HotkeyBinding> = {},
): HotkeyBinding {
	return {
		id: `binding-${action}`,
		key: {
			code: 'KeyK',
			modifiers: { ctrl: false, alt: false, shift: false, meta: false },
		},
		action,
		enabled: true,
		...overrides,
	};
}

function settings(bindings: HotkeyBinding[]): HotkeySettings {
	return {
		...structuredClone(DEFAULT_HOTKEY_SETTINGS),
		sites: {
			'example.com': {
				enabled: true,
				bindings,
			},
		},
	};
}

describe('SPECTRA lean custom-site hotkey boundary', () => {
	test('admits only canonical-step page-default-equivalent bindings', () => {
		for (const action of ['speed_up', 'speed_down', 'volume_up', 'volume_down', 'volume_mute'] as const) {
			expect(resolveSiteHotkeys('https://example.com/watch', settings([binding(action)]))?.mode).toBe('lean');
		}
		expect(resolveSiteHotkeys(
			'https://example.com/watch',
			settings([binding('speed_up', { params: { step: 0.1 } })]),
		)?.mode).toBe('lean');
		expect(resolveSiteHotkeys(
			'https://example.com/watch',
			settings([binding('volume_down', { params: { step: 10 } })]),
		)?.mode).toBe('lean');
		expect(resolveSiteHotkeys(
			'https://example.com/watch',
			settings([binding('speed_up', { params: { step: 0.25 } })]),
		)?.mode).toBe('full');
	});

	test('fails closed to the full runtime for any live non-equivalent action', () => {
		for (const action of [
			'play_pause',
			'seek_forward_5s',
			'fullscreen_toggle',
			'pip_toggle',
			'screenshot',
			'delay_up',
			'open_url',
		] as const) {
			expect(resolveSiteHotkeys('https://example.com', settings([binding(action)]))?.mode).toBe('full');
		}
	});

	test('treats explicit no-op and unavailable bindings as inactive runtime ownership', () => {
		expect(resolveSiteHotkeys('https://example.com', settings([binding('none')]))).toBeNull();
		expect(resolveSiteHotkeys(
			'https://example.com',
			settings([binding('speed_up'), binding('none')]),
		)?.mode).toBe('lean');
	});

	test('one complex live binding forces the whole site to full, while disabled ones do not', () => {
		expect(resolveSiteHotkeys(
			'https://example.com',
			settings([binding('speed_up'), binding('fullscreen_toggle')]),
		)?.mode).toBe('full');
		expect(resolveSiteHotkeys(
			'https://example.com',
			settings([
				binding('speed_up'),
				binding('fullscreen_toggle', { enabled: false }),
			]),
		)?.mode).toBe('lean');
	});

	test('uses the most-specific domain as an explicit enabled/disabled override', () => {
		const nested = settings([binding('speed_up')]);
		const nestedSite = {
			enabled: true,
			bindings: [binding('volume_up', { id: 'nested-volume' })],
		};
		nested.sites['video.example.com'] = nestedSite;
		expect(resolveSiteHotkeys('https://video.example.com/a', nested)?.domain).toBe('video.example.com');
		nestedSite.enabled = false;
		expect(resolveSiteHotkeys('https://video.example.com/a', nested)).toBeNull();
		expect(resolveSiteHotkeys('https://unmatched.test/a', nested)).toBeNull();
	});

	test('keeps repeatability exactly on the four scalar default actions', () => {
		for (const action of ['speed_up', 'speed_down', 'volume_up', 'volume_down']) {
			expect(isLeanRepeatableSiteHotkeyAction(action)).toBe(true);
		}
		expect(isLeanRepeatableSiteHotkeyAction('volume_mute')).toBe(false);
		expect(isLeanRepeatableSiteHotkeyAction('fullscreen_toggle')).toBe(false);
	});
});

describe('lean site-page trigger contract', () => {
	test('extends the existing default-hotkey trigger with one exact sender-document disposition', () => {
		expect(isSpectraDefaultHotkeyTriggerPayload({
			action: 'speed_up',
			phase: 'press',
			gesture: 'site:1',
			repeated: false,
			disposition: 'site-page',
		})).toBe(true);
		expect(isSpectraDefaultHotkeyTriggerPayload({
			action: 'speed_up',
			phase: 'press',
			gesture: 'site:1',
			repeated: false,
		})).toBe(true);
		expect(isSpectraDefaultHotkeyTriggerPayload({
			action: 'speed_up',
			phase: 'press',
			gesture: 'site:1',
			repeated: false,
			disposition: 'global',
		})).toBe(false);
	});

});
