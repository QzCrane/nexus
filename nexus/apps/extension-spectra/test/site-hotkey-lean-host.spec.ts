import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_HOTKEY_SETTINGS,
	type HotkeyAction,
	type HotkeyBinding,
	type HotkeySettings,
} from '@nexus/contracts';
import {
	isLeanRepeatableSiteHotkeyAction,
	resolveSiteHotkeys,
} from '../src/shared/site-hotkey-mode';

const hostSource = readFileSync(
	new URL('../src/content/input/lean-site-hotkey-host.ts', import.meta.url),
	'utf8',
);

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

	test('uses the existing domain matcher and ignores disabled/empty sites', () => {
		const nested = settings([binding('speed_up')]);
		nested.sites['video.example.com'] = {
			enabled: true,
			bindings: [binding('volume_up', { id: 'nested-volume' })],
		};
		expect(resolveSiteHotkeys('https://video.example.com/a', nested)?.domain).toBe('video.example.com');
		nested.sites['video.example.com'].enabled = false;
		expect(resolveSiteHotkeys('https://video.example.com/a', nested)?.domain).toBe('example.com');
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

describe('lean site-hotkey host source contract', () => {
	test('reuses the canonical default trigger and website-first arbiter without heavy runtime imports', () => {
		expect(hostSource).toContain("type: 'spectra.content.default-hotkey.trigger'");
		expect(hostSource).toContain('createWebsiteFirstKeyboardArbiter');
		expect(hostSource).toContain('resolveSpectraDefaultHotkeyAction(event) !== null');
		expect(hostSource).not.toContain("from '../core/index'");
		expect(hostSource).not.toContain('native-media-executor');
		expect(hostSource).not.toContain('hotkey-actions');
		expect(hostSource).not.toContain('setInterval');
	});

	test('owns a physical gesture through keyup and fully detaches browser listeners', () => {
		expect(hostSource).toContain('activeByCode.set(event.code, held)');
		expect(hostSource).toContain('subscribeDocumentStartPhysicalHotkeyRelease(onPhysicalRelease)');
		expect(hostSource).toContain("sendTrigger(held, 'release', held.repeated)");
		expect(hostSource).toContain("window.removeEventListener('blur', onBlur)");
		expect(hostSource).toContain("window.removeEventListener('pagehide', onPageHide)");
		expect(hostSource).toContain("document.removeEventListener('visibilitychange', onVisibilityChange)");
	});
});
