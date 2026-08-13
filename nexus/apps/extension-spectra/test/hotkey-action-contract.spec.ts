import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
} from '@nexus/contracts';
import { HOTKEY_ACTION_HANDLERS } from '../src/content/input/hotkey-actions';
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
			expect(Object.hasOwn(HOTKEY_ACTION_HANDLERS, action), action).toBe(true);
		}
	});

	test('maps every persisted hotkey to one canonical capability or an explicit disabled disposition', () => {
		expect(Object.isFrozen(HOTKEY_ACTIONS)).toBe(true);
		expect(HOTKEY_ACTIONS).toEqual(Object.keys(HOTKEY_ACTION_DESCRIPTORS));
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
		const bootstrap = readFileSync(
			resolve(import.meta.dir, '../src/content/core/bootstrap.ts'),
			'utf8',
		);
		expect(bootstrap).toContain('resolveSpectraDefaultHotkeyAction(event)');
		expect(bootstrap).toContain("'spectra.content.default-hotkey.trigger'");
		expect(bootstrap).toContain('isEditableHotkeyEvent(event)');
		expect(bootstrap).toContain('acceptDefaultHotkeyKeydown(event, action)');
		expect(bootstrap).not.toContain('createWebsiteFirstKeyboardArbiter({');
		expect(bootstrap).toContain('event.stopImmediatePropagation()');
		expect(bootstrap).toContain(
			"window.addEventListener('keydown', onDefaultHotkeyKeydown, true)",
		);
		expect(bootstrap).toContain(
			"window.addEventListener('keyup', onDefaultHotkeyKeyup, true)",
		);
		expect(bootstrap).toContain('releaseDefaultScalarKeys');
		expect(bootstrap).toContain('publishDefaultScalarGesture');
		expect(bootstrap).toContain('publishHotkeyActualFeedback(message)');
		const eventArbiter = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-event.ts'),
			'utf8',
		);
		expect(eventArbiter).toContain('const pending = new Map<KeyboardEvent');
		expect(eventArbiter).toContain('window.addEventListener(options.type, capture, true)');
		expect(eventArbiter).toContain('window.addEventListener(options.type, tail)');
		expect(eventArbiter).toContain('const candidate = options.resolveCandidate(event)');
		expect(eventArbiter).toContain('pending.set(event, { candidate, tail, cleanupTimer })');
		expect(eventArbiter).toContain('if (tailEvent !== event) return;');
		expect(eventArbiter).toContain('const owned = clearPending(event)');
		expect(eventArbiter).toContain('owned.candidate');
		expect(eventArbiter).toContain('event.defaultPrevented || event.cancelBubble');
		expect(eventArbiter).toMatch(
			/const cleanupTimer = setTimeout\(\(\) => \{[\s\S]*options\.onSettled\(event, owned\.candidate, true\);[\s\S]*\}, 0\);/u,
		);
		expect(eventArbiter).toContain('window.removeEventListener(options.type, owned.tail)');
		expect(eventArbiter).toContain('clearTimeout(owned.cleanupTimer)');
		expect(eventArbiter).toContain('window.removeEventListener(options.type, capture, true)');
		expect(eventArbiter).toContain('for (const [event] of pending) clearPending(event)');
		expect(eventArbiter).not.toContain('queueMicrotask');
		const listener = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'),
			'utf8',
		);
		expect((listener.match(/createWebsiteFirstKeyboardArbiter\(\{/gu) ?? [])).toHaveLength(1);
		const directKeyboardRegistration =
			/(?:window|document)\.(?:add|remove)EventListener\(\s*['"]key(?:down|up)['"]/u;
		expect(bootstrap).toMatch(directKeyboardRegistration);
		expect(listener).not.toMatch(directKeyboardRegistration);
		expect(listener).not.toMatch(/\.stop(?:Immediate)?Propagation\(/u);
		expect(listener).toContain('subscribeHotkeyReplay((signal) =>');
		expect(listener).toContain('subscribePhysicalHotkeyRelease(releaseSiteHotkeys)');
		expect(listener).toContain('resolveSpectraDefaultHotkeyAction(e) !== null');
		expect(listener).toContain('isEditableHotkeyEvent(e)');
		expect(listener).toContain('resolveCandidate: resolveSiteHotkeyBinding');
		expect(listener).toContain('handleKeydown(event, binding)');
		expect(eventArbiter).toContain('subscribeDocumentStartPhysicalHotkeyRelease');
		expect(eventArbiter).toContain("const PHYSICAL_RELEASE_OWNER_KEY = '__spectraPhysicalHotkeyReleaseV1'");
		const initialization = listener.slice(
			listener.indexOf('export async function initHotkeyListener'),
			listener.indexOf('function handleSettingsEvent'),
		);
		expect(initialization.indexOf('subscribePhysicalHotkeyRelease(releaseSiteHotkeys)'))
			.toBeLessThan(initialization.indexOf('synchronizeKeydownListener()'));
		const settingsChange = listener.slice(
			listener.indexOf("message.type === 'spectra.hotkeys.changed'"),
			listener.indexOf('async function loadSettings'),
		);
		expect(settingsChange.indexOf('cancelActiveBindings()'))
			.toBeLessThan(settingsChange.indexOf('settings = message.payload'));
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
		expect(listener).toContain('if (!isTrustedHotkeyEvent(e)) return null;');
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
			listener.indexOf('// Only a new physical repeat'),
			listener.indexOf('function releaseSiteHotkeys'),
		);
		const completionBranch = listener.slice(
			listener.indexOf('function executeBinding'),
			listener.indexOf('function handleKeydown'),
		);
		expect(repeatBranch).toContain('coalescedBinding(binding, takeRepeatPulses(held.feedbackGesture))');
		expect(repeatBranch).toContain('held.feedbackGesture');
		expect(repeatBranch).not.toContain('setTimeout(');
		expect(repeatBranch).not.toContain('executeWithOSD(binding)');
		expect(completionBranch).not.toContain('executeBinding(coalescedBinding');
		expect(listener).toContain('activeBindingsByCode.get(e.code)');
		expect(listener).toContain('releaseSiteHotkeys({ code: e.code })');
		expect(listener).toContain('inFlightGestures.has(held.feedbackGesture)');
		expect(listener).toContain('lastRepeatExecutionAt.set(held.feedbackGesture, e.timeStamp)');
		expect(listener).toContain('freezeHotkeyToast(held.feedbackGesture)');
		expect(listener).toContain('freezeHotkeyTargetOSD(held.feedbackGesture)');
		expect(listener).toContain('releaseHotkeyToast(held.feedbackGesture)');
		expect(listener).toContain('releaseHotkeyTargetOSD(held.feedbackGesture)');
		expect(listener).toContain('releasedFeedbackGestures');
		expect(listener).toContain('pendingRepeatPulses');
		expect(listener).toContain('coalescedBinding');
		expect(listener).not.toContain('const coalesced = new Map');
		expect(listener).not.toContain('cancelCoalesced');
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
