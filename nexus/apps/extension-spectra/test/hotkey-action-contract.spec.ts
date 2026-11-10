import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HOTKEY_SETTINGS,
	HOTKEY_ACTIONS,
	HOTKEY_ACTION_DESCRIPTORS,
	SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE,
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	isHotkeyParamsForAction,
	isHotkeySettings,
	isSpectraDefaultHotkeyKeyCombo,
	isSlotHotkeyAction,
	resolveSpectraDefaultHotkeyAction,
	selectHotkeyActionDescriptor,
	selectHotkeyAvailability,
	selectHotkeyCapability,
	selectHotkeyFeedbackOwner,
	selectHotkeyParameterKind,
	selectHotkeyRepeatPolicy,
	hotkeyActionRequiresUserActivation,
} from '@nexus/contracts';
import { HOTKEY_ACTION_HANDLERS } from '../src/content/input/hotkey-actions';
import { isTrustedHotkeyEvent } from '../src/content/input/hotkey-event';
import { needsManifestVolumeCommand } from '../src/shared/content-runtime';
import {
	EDITABLE_HOTKEY_ACTIONS,
	LEGACY_UNSUPPORTED_ACTIONS,
	PARAMETER_REQUIRED_HOTKEY_ACTIONS,
	SLOT_HOTKEY_ACTIONS,
} from '../src/options/supported-hotkey-actions';

describe('editable hotkey action contract', () => {
	test('every action exposed by Options has a concrete runtime handler', () => {
		for (const action of EDITABLE_HOTKEY_ACTIONS) {
			expect(Object.hasOwn(HOTKEY_ACTION_HANDLERS, action), action).toBe(true);
		}
	});

	test('maps every persisted hotkey to one canonical capability or an explicit disabled disposition', () => {
		expect(Object.isFrozen(HOTKEY_ACTIONS)).toBe(true);
		expect(HOTKEY_ACTIONS).toEqual(Object.keys(HOTKEY_ACTION_DESCRIPTORS));
		for (const action of HOTKEY_ACTIONS) {
			const descriptor = HOTKEY_ACTION_DESCRIPTORS[action];
			expect(selectHotkeyActionDescriptor(action), action).toEqual(descriptor);
			expect(selectHotkeyCapability(action), action).toBe(descriptor.capability);
			expect(selectHotkeyAvailability(action), action).toBe(descriptor.availability);
			expect(selectHotkeyRepeatPolicy(action), action).toBe(descriptor.repeatPolicy);
			expect(selectHotkeyParameterKind(action), action).toBe(descriptor.parameter);
			expect(selectHotkeyFeedbackOwner(action), action).toBe(descriptor.feedbackOwner);
			expect(hotkeyActionRequiresUserActivation(action), action)
				.toBe(descriptor.requiresUserActivation);
			if (descriptor.availability === 'enabled') expect(descriptor.capability, action).not.toBeNull();
			if (descriptor.availability === 'disabled-legacy') expect(descriptor.capability, action).toBeNull();
			expect(['actual-osd', 'handler-result', 'listener-label', 'none']).toContain(
				descriptor.feedbackOwner,
			);
		}
	});

	test('assigns exactly one feedback owner and never adds a second generic toast', () => {
		expect(HOTKEY_ACTION_DESCRIPTORS.volume_up.feedbackOwner).toBe('actual-osd');
		expect(HOTKEY_ACTION_DESCRIPTORS.speed_down.feedbackOwner).toBe('actual-osd');
		expect(HOTKEY_ACTION_DESCRIPTORS.marker_add.feedbackOwner).toBe('handler-result');
		expect(HOTKEY_ACTION_DESCRIPTORS.show_info.feedbackOwner).toBe('handler-result');
		expect(HOTKEY_ACTION_DESCRIPTORS.pan_left.feedbackOwner).toBe('listener-label');
		expect(HOTKEY_ACTION_DESCRIPTORS.open_popup.feedbackOwner).toBe('none');
	});

	test('ships all five defaults through one website-safe bootstrap gesture boundary', () => {
		expect(DEFAULT_HOTKEY_SETTINGS.slots).toEqual({});
		expect(Object.keys(SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE)).toHaveLength(5);
		expect(SPECTRA_DEFAULT_HOTKEY_ACTIONS).toEqual(
			Object.values(SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE),
		);
		for (const action of SPECTRA_DEFAULT_HOTKEY_ACTIONS) {
			expect(isSlotHotkeyAction(action), action).toBe(false);
		}
		const chord = (code: string, modifiers: Partial<{
			altKey: boolean;
			ctrlKey: boolean;
			shiftKey: boolean;
			metaKey: boolean;
		}> = {}) => ({
			code,
			altKey: true,
			ctrlKey: false,
			shiftKey: false,
			metaKey: false,
			...modifiers,
		});
		for (const [code, action] of Object.entries(SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE)) {
			expect(resolveSpectraDefaultHotkeyAction(chord(code))).toBe(action);
			expect(isSpectraDefaultHotkeyKeyCombo({
				code,
				modifiers: { ctrl: false, alt: true, shift: false, meta: false },
			})).toBe(true);
		}
		expect(isSpectraDefaultHotkeyKeyCombo({
			code: 'ArrowUp',
			modifiers: { ctrl: true, alt: true, shift: false, meta: false },
		})).toBe(false);
		expect(isSpectraDefaultHotkeyKeyCombo({
			code: 'ArrowUp',
			modifiers: { ctrl: false, alt: false, shift: false, meta: false },
		})).toBe(false);
		expect(resolveSpectraDefaultHotkeyAction(chord('ArrowUp', { ctrlKey: true }))).toBeNull();
		expect(resolveSpectraDefaultHotkeyAction(chord('KeyU'))).toBeNull();
	});

	test('unsupported pitch actions remain outside the editable registry', () => {
		for (const action of LEGACY_UNSUPPORTED_ACTIONS) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(false);
		}
	});

	test('command slots expose only discrete executable actions that need no persisted parameters', () => {
		for (const action of SLOT_HOTKEY_ACTIONS) {
			expect(Object.hasOwn(HOTKEY_ACTION_HANDLERS, action), action).toBe(true);
			expect(PARAMETER_REQUIRED_HOTKEY_ACTIONS.has(action), action).toBe(false);
			expect(HOTKEY_ACTION_DESCRIPTORS[action].repeatPolicy, action).not.toBe('coalesce-20hz');
		}
		for (const action of ['speed_set', 'volume_set', 'run_js', 'open_url'] as const) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(true);
			expect(SLOT_HOTKEY_ACTIONS.has(action), action).toBe(false);
			expect(isSlotHotkeyAction(action), action).toBe(false);
		}
		expect(isSlotHotkeyAction('pitch_up')).toBe(false);
		expect(isSlotHotkeyAction('seek_forward_5s')).toBe(false);
		expect(isSlotHotkeyAction('future_action')).toBe(false);
	});

	test('migrates Capture implementation shortcuts to disabled legacy state', () => {
		expect(HOTKEY_ACTION_DESCRIPTORS.capture_toggle).toMatchObject({
			availability: 'disabled-legacy',
			capability: null,
		});
	});

	test('validates required hotkey parameters at storage and execution boundaries', () => {
		expect(isHotkeyParamsForAction('speed_set', { speed: 1.5 })).toBe(true);
		expect(isHotkeyParamsForAction('speed_set', undefined)).toBe(false);
		expect(isHotkeyParamsForAction('volume_set', { volume: 100 })).toBe(true);
		expect(isHotkeyParamsForAction('volume_set', { volume: 101 })).toBe(true);
		expect(isHotkeyParamsForAction('volume_set', { volume: 800 })).toBe(true);
		expect(isHotkeyParamsForAction('volume_set', { volume: 801 })).toBe(false);
		expect(isHotkeyParamsForAction('open_url', { url: 'javascript:alert(1)' })).toBe(false);
		expect(isHotkeyParamsForAction('open_url', { url: 'https://example.com/' })).toBe(true);
		expect(isHotkeyParamsForAction('run_js', { script: '' })).toBe(false);
		expect(isHotkeyParamsForAction('volume_up', { step: 10 })).toBe(true);
		expect(isHotkeyParamsForAction('volume_up', { volume: 10 })).toBe(false);

		expect(isHotkeySettings({
			slots: { slot_01: 'speed_set' },
			sites: {},
		})).toBe(false);
	});
});

describe('page hotkey trust boundary', () => {
	test('rejects synthetic KeyboardEvents before matching privileged actions', () => {
		expect(isTrustedHotkeyEvent({ isTrusted: false })).toBe(false);
		expect(isTrustedHotkeyEvent({ isTrusted: true })).toBe(true);
	});
});

describe('Alt+Up invocation gate', () => {
	test('yields only a cold document at the native ceiling to the manifest command', () => {
		expect(needsManifestVolumeCommand(false, 1)).toBe(true);
		expect(needsManifestVolumeCommand(false, 0.999)).toBe(true);
		expect(needsManifestVolumeCommand(false, 0.99)).toBe(false);
		expect(needsManifestVolumeCommand(false, null)).toBe(false);
	});

	test('keeps an invoked document on the content path even after Capture stops', () => {
		expect(needsManifestVolumeCommand(true, 1)).toBe(false);
		expect(needsManifestVolumeCommand(true, 0.5)).toBe(false);
	});
});
