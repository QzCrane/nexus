import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	DEFAULT_SLOTS,
	HOTKEY_ACTIONS,
	HOTKEY_ACTION_DESCRIPTORS,
	PRESET_BINDINGS,
	isHotkeyParamsForAction,
	isHotkeySettings,
	isSlotHotkeyAction,
} from '@nexus/contracts';
import { HANDLED_HOTKEY_ACTIONS } from '../src/content/input/hotkey-actions';
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

	test('maps every persisted hotkey to one canonical capability or an explicit disabled disposition', () => {
		expect(Object.keys(HOTKEY_ACTION_DESCRIPTORS).sort()).toEqual([...HOTKEY_ACTIONS].sort());
		for (const action of HOTKEY_ACTIONS) {
			const descriptor = HOTKEY_ACTION_DESCRIPTORS[action];
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

		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		expect(listener).toContain("feedbackOwner === 'listener-label'");
		expect(listener).not.toContain("action !== 'open_popup'");
	});

	test('ships every holdable Alt+Arrow scalar default through one bootstrap gesture boundary', () => {
		expect(DEFAULT_SLOTS.speed_down).toBeUndefined();
		expect(DEFAULT_SLOTS.speed_up).toBeUndefined();
		expect(DEFAULT_SLOTS.volume_down).toBeUndefined();
		expect(DEFAULT_SLOTS.volume_up).toBeUndefined();
		expect(PRESET_BINDINGS.some((binding) =>
			binding.key.modifiers.alt
			&& (binding.key.code === 'ArrowLeft' || binding.key.code === 'ArrowRight'))).toBe(false);
		const bootstrap = readFileSync(
			resolve(import.meta.dir, '../src/content/core/bootstrap.ts'),
			'utf8',
		);
		expect(bootstrap).toContain("if (event.code === 'ArrowLeft') return 'speed_down'");
		expect(bootstrap).toContain("if (event.code === 'ArrowRight') return 'speed_up'");
		expect(bootstrap).toContain("if (event.code === 'ArrowDown') return 'volume_down'");
		expect(bootstrap).toContain("if (event.code === 'ArrowUp') return 'volume_up'");
		expect(bootstrap).toContain("'spectra.content.default-hotkey.trigger'");
		expect(bootstrap).toContain('event.stopImmediatePropagation()');
		expect(bootstrap).toContain('releaseDefaultScalarKeys');
		expect(bootstrap).toContain('publishDefaultScalarGesture');
		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		expect(listener).toContain('subscribeDefaultScalarGesture(handleDefaultScalarGesture)');
		expect(listener).toContain('lastDefaultScalarFeedbackTarget');
	});

	test('keeps every direct manifest action inside the discrete command-slot boundary', () => {
		for (const action of Object.values(DEFAULT_SLOTS)) {
			expect(isSlotHotkeyAction(action), action).toBe(true);
			expect(HOTKEY_ACTION_DESCRIPTORS[action].repeatPolicy, action).not.toBe('coalesce-20hz');
		}
	});

	test('unsupported pitch actions remain outside the editable registry', () => {
		for (const action of LEGACY_UNSUPPORTED_ACTIONS) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(false);
		}
	});

	test('command slots expose only discrete executable actions that need no persisted parameters', () => {
		for (const action of SLOT_HOTKEY_ACTIONS) {
			expect(HANDLED_HOTKEY_ACTIONS.has(action), action).toBe(true);
			expect(PARAMETER_REQUIRED_HOTKEY_ACTIONS.has(action), action).toBe(false);
			expect(HOTKEY_ACTION_DESCRIPTORS[action].repeatPolicy, action).not.toBe('coalesce-20hz');
		}
		for (const action of ['speed_set', 'volume_set', 'run_js', 'open_url'] as const) {
			expect(EDITABLE_HOTKEY_ACTIONS.has(action), action).toBe(true);
			expect(SLOT_HOTKEY_ACTIONS.has(action), action).toBe(false);
			expect(isSlotHotkeyAction(action), action).toBe(false);
		}
		expect(isSlotHotkeyAction('pitch_up')).toBe(false);
		expect(isSlotHotkeyAction('volume_up')).toBe(false);
		expect(isSlotHotkeyAction('seek_forward_5s')).toBe(false);
		expect(isSlotHotkeyAction('future_action')).toBe(false);
	});

	test('migrates Capture implementation shortcuts to disabled legacy state', () => {
		expect(HOTKEY_ACTION_DESCRIPTORS.capture_toggle).toMatchObject({
			availability: 'disabled-legacy',
			capability: null,
		});
		const helper = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-helpers.ts'),
			'utf8',
		);
		expect(helper).not.toContain("'spectra.audio.capture.set'");
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

		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		expect(listener).toContain('if (!isTrustedHotkeyEvent(e)) return;');
	});

	test('reports trusted activation results as exact DOM-native page observations', () => {
		const helper = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-helpers.ts'),
			'utf8',
		);
		expect(helper).toContain("source: 'page'");
		expect(helper).toContain("observedStrategies: { [field]: 'dom-native' }");
	});

	test('coalesces held shortcuts without repeat toasts and settles on physical keyup', () => {
		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		const repeatBranch = listener.slice(
			listener.indexOf('// Repeat keydown under coalesce-20hz'),
			listener.indexOf('function handleKeyup'),
		);
		const completionBranch = listener.slice(
			listener.indexOf('function executeBinding'),
			listener.indexOf('function handleKeydown'),
		);
		expect(repeatBranch).toContain('coalescedBinding(binding, takeRepeatPulses(binding.id))');
		expect(repeatBranch).toContain('active.feedbackGesture');
		expect(repeatBranch).not.toContain('executeWithOSD(binding)');
		expect(completionBranch).not.toContain('executeBinding(coalescedBinding');
		expect(listener).toContain('activeBindingsByCode.get(e.code)');
		expect(listener).toContain('cancelCoalesced(active.binding.id)');
		expect(listener).toContain('inFlightBindings.has(binding.id)');
		expect(listener).toContain('const active = activeBinding(binding.id)');
		expect(listener).toContain('freezeHotkeyToast(held.feedbackGesture)');
		expect(listener).toContain('freezeHotkeyTargetOSD(held.feedbackGesture)');
		expect(listener).toContain('releaseHotkeyToast(held.feedbackGesture)');
		expect(listener).toContain('releaseHotkeyTargetOSD(held.feedbackGesture)');
		expect(listener).toContain('releasedFeedbackGestures');
		expect(listener).toContain('pendingRepeatPulses');
		expect(listener).toContain('coalescedBinding');
		expect(listener).toContain("feedbackOwner === 'listener-label'");
		expect(listener).toContain("e.code === 'F5'");
		expect(listener).toContain("e.code === 'KeyR'");
		expect(listener).toContain("createEventListener(window, 'blur', cancelActiveBindings)");
		expect(listener).toContain("createEventListener(window, 'pagehide', cancelActiveBindings)");
		const toast = readFileSync(
			resolve(import.meta.dir, '../src/content/ui/toast.ts'),
			'utf8',
		);
		const feedbackSurface = readFileSync(
			resolve(import.meta.dir, '../src/content/ui/feedback-surface.ts'),
			'utf8',
		);
		expect(toast).toContain('createFeedbackSurface(');
		expect(feedbackSurface).toContain('document.documentElement.appendChild(host)');
		expect(toast).toContain('!s.host?.isConnected');
		expect(toast).not.toContain('if (!document.body) return');
	});
});
