import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	executeHotkeyAction,
	HANDLED_HOTKEY_ACTIONS,
	setCaptureModeToggler,
} from '../src/content/input/hotkey-actions';
import { isTrustedHotkeyEvent } from '../src/content/input/hotkey-event';
import {
	EDITABLE_HOTKEY_ACTIONS,
	LEGACY_UNSUPPORTED_ACTIONS,
	PARAMETER_REQUIRED_HOTKEY_ACTIONS,
	SLOT_HOTKEY_ACTIONS,
} from '../src/options/supported-hotkey-actions';

describe('editable hotkey action contract', () => {
	test('every action exposed by Options has a concrete runtime handler', () => {
		for (const action of EDITABLE_HOTKEY_ACTIONS) {
			expect(HANDLED_HOTKEY_ACTIONS.has(action), action).toBe(true);
		}
	});

	test('unsupported pitch actions remain outside the editable registry', () => {
		for (const action of LEGACY_UNSUPPORTED_ACTIONS) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(false);
		}
	});

	test('command slots expose only executable actions that need no persisted parameters', () => {
		for (const action of SLOT_HOTKEY_ACTIONS) {
			expect(HANDLED_HOTKEY_ACTIONS.has(action), action).toBe(true);
			expect(PARAMETER_REQUIRED_HOTKEY_ACTIONS.has(action), action).toBe(false);
		}
		for (const action of ['speed_set', 'volume_set', 'run_js', 'open_url'] as const) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(true);
			expect(SLOT_HOTKEY_ACTIONS.has(action), action).toBe(false);
		}
	});

	test('routes Capture hotkeys through the content-owned mode state machine', () => {
		const toggle = mock(() => undefined);
		const dispose = setCaptureModeToggler(toggle);
		try {
			executeHotkeyAction('capture_toggle');
			expect(toggle).toHaveBeenCalledTimes(1);
		} finally {
			dispose();
		}
		const helper = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-helpers.ts'),
			'utf8',
		);
		expect(helper).not.toContain("'spectra.audio.capture.set'");
	});
});

describe('page hotkey trust boundary', () => {
	test('rejects synthetic KeyboardEvents before matching privileged actions', () => {
		expect(isTrustedHotkeyEvent({ isTrusted: false })).toBe(false);
		expect(isTrustedHotkeyEvent({ isTrusted: true })).toBe(true);

		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		expect(listener).toContain('if (!isTrustedHotkeyEvent(e)) return;');
	});
});
