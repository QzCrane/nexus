// goal: handles global chrome keyboard shortcuts (manifest commands and custom slots)
// rule: standard commands are mapped directly; custom slots (slot_1-16) use user-defined mappings

import type { ControlMutation, HotkeySettings, HotkeyAction } from '@nexus/contracts';
import { DEFAULT_HOTKEY_SETTINGS, isSlotHotkeyAction } from '@nexus/contracts';
import { swLog } from '../shared/logger';
import { settingsRepository } from './settings-repository';
import { hotkeyTargetRepository } from './hotkey-target-repository';
import { submitControlOperation, submitControlRequest } from './control-coordinator';

// slotMapping: active mapping of manifest slot IDs to functional hotkey actions
let slotMapping: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEY_SETTINGS.slots };


// eff: synchronizes slotMapping from the background-owned settings repository
async function loadSlotMapping(): Promise<void> {
	try {
		updateShortcutSettings((await settingsRepository.getSnapshot()).hotkeySettings);
	} catch { }
}

export function updateShortcutSettings(settings: HotkeySettings): void {
	slotMapping = Object.fromEntries(
		Object.entries(settings.slots).filter(([, action]) => isSlotHotkeyAction(action)),
	);
}

// eff: initializes global listeners for chrome.commands and repository-backed hotkey updates
export function setupShortcutListeners(): void {
	void loadSlotMapping();

	chrome.commands.onCommand.addListener(async (command) => {
		swLog.debug(`Shortcut command: ${command}`);

		const tab = await resolveShortcutTarget();
		if (!tab?.id || !tab.url) return;

		let domain = '';
		try {
			domain = new URL(tab.url).hostname;
		} catch {
			return;
		}

		let action: HotkeyAction | undefined;
		if (command.startsWith('slot_')) {
			action = slotMapping[command];
			if (!action || action === 'none') return;
		} else {
			action = resolveDirectCommand(command);
		}

		if (!action) return;

		await executeAction(action, tab.id, domain);
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		void clearRemovedShortcutTarget(tabId);
	});
}

async function resolveShortcutTarget(): Promise<chrome.tabs.Tab | undefined> {
	const { tabId: targetId } = await hotkeyTargetRepository.get();
	if (targetId !== null) {
		try {
			const target = await chrome.tabs.get(targetId);
			if (target.url && /^https?:/u.test(target.url)) return target;
		} catch {
			await hotkeyTargetRepository.clearIfMatches(targetId);
		}
	}
	const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
	return active?.url && /^https?:/u.test(active.url) ? active : undefined;
}

async function clearRemovedShortcutTarget(tabId: number): Promise<void> {
	await hotkeyTargetRepository.clearIfMatches(tabId);
}

// goal: maps literal manifest command names to unified HotkeyActions
function resolveDirectCommand(command: string): HotkeyAction | undefined {
	const map: Record<string, HotkeyAction> = {
		volume_up: 'volume_up',
		volume_down: 'volume_down',
		toggle_mute: 'volume_mute',
		speed_up: 'speed_up',
	};
	return map[command];
}

const FULL_OUTPUT_FIELDS = new Set<ControlMutation['field']>([
	'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay', 'tabMuted', 'tabPinned',
]);

async function submitMutations(tabId: number, mutations: ControlMutation[]): Promise<void> {
	for (const requestedCoverage of ['active-target', 'full'] as const) {
		const selected = mutations.filter((mutation) =>
			FULL_OUTPUT_FIELDS.has(mutation.field) === (requestedCoverage === 'full'));
		if (selected.length === 0) continue;
		const acknowledgement = await submitControlRequest({
			tabId,
			source: 'hotkey',
			requestedCoverage,
			target: null,
			mutations: selected,
		});
		const failure = Object.values(acknowledgement.fields)
			.find((field) => field?.phase !== 'applied');
		if (failure) throw new Error(failure.lastError?.message ?? 'Shortcut control was not applied');
	}
}

// eff: translates Chrome commands directly into the same coordinator protocol
// used by Popup, page hotkeys and authenticated remote controls.
async function executeAction(action: HotkeyAction, tabId: number, _domain: string): Promise<void> {
	try {
		const operation = async (
			type: Parameters<typeof submitControlOperation>[0]['operation'],
			payload: Parameters<typeof submitControlOperation>[0]['payload'] = {},
		) => submitControlOperation({
			tabId,
			source: 'hotkey',
			target: null,
			operation: type,
			payload,
		} as Parameters<typeof submitControlOperation>[0]);
		switch (action) {
			case 'none':
			case 'pitch_up':
			case 'pitch_down':
			case 'pitch_reset':
			case 'capture_toggle':
			case 'run_js':
			case 'open_url': return;
			case 'play_pause': await operation('playback-toggle'); return;
			case 'seek_forward_5s': await operation('seek-relative', { delta: 5 }); return;
			case 'seek_forward_10s': await operation('seek-relative', { delta: 10 }); return;
			case 'seek_forward_30s': await operation('seek-relative', { delta: 30 }); return;
			case 'seek_backward_5s': await operation('seek-relative', { delta: -5 }); return;
			case 'seek_backward_10s': await operation('seek-relative', { delta: -10 }); return;
			case 'seek_backward_30s': await operation('seek-relative', { delta: -30 }); return;
			case 'seek_frame_forward': await operation('frame-step', { direction: 1 }); return;
			case 'seek_frame_backward': await operation('frame-step', { direction: -1 }); return;
			case 'audio_reset': await operation('audio-reset'); return;
			case 'screenshot': await operation('screenshot'); return;
			case 'marker_add': await operation('marker-add'); return;
			case 'marker_jump_prev': await operation('marker-jump-previous'); return;
			case 'marker_jump_next': await operation('marker-jump-next'); return;
			case 'ab_set_a': await operation('ab-set-a'); return;
			case 'ab_set_b': await operation('ab-set-b'); return;
			case 'ab_clear': await operation('ab-clear'); return;
			case 'ab_skip': await operation('ab-skip'); return;
			case 'fx_toggle': await operation('video-effects-toggle'); return;
			case 'fx_reset': await operation('video-effects-reset'); return;
			case 'show_info': await operation('show-info'); return;
			case 'open_popup': await operation('open-popup'); return;
			case 'open_options': await operation('open-options'); return;
			case 'speed_up': await submitMutations(tabId, [{ field: 'speed', operation: 'delta', value: 0.1 }]); return;
			case 'speed_down': await submitMutations(tabId, [{ field: 'speed', operation: 'delta', value: -0.1 }]); return;
			case 'speed_reset': await submitMutations(tabId, [{ field: 'speed', operation: 'set', value: 1 }]); return;
			case 'speed_set': return;
			case 'volume_up': await operation('effective-volume', { operation: 'delta', value: 10 }); return;
			case 'volume_down': await operation('effective-volume', { operation: 'delta', value: -10 }); return;
			case 'volume_mute': await submitMutations(tabId, [{ field: 'mediaMuted', operation: 'toggle' }]); return;
			case 'volume_set': return;
			case 'gain_up': await operation('effective-volume', { operation: 'delta', value: 10 }); return;
			case 'gain_down': await operation('effective-volume', { operation: 'delta', value: -10 }); return;
			case 'delay_up': await submitMutations(tabId, [{ field: 'delay', operation: 'delta', value: 10 }]); return;
			case 'delay_down': await submitMutations(tabId, [{ field: 'delay', operation: 'delta', value: -10 }]); return;
			case 'delay_reset': await submitMutations(tabId, [{ field: 'delay', operation: 'set', value: 0 }]); return;
			case 'pan_left': await submitMutations(tabId, [{ field: 'pan', operation: 'delta', value: -0.1 }]); return;
			case 'pan_right': await submitMutations(tabId, [{ field: 'pan', operation: 'delta', value: 0.1 }]); return;
			case 'pan_reset': await submitMutations(tabId, [{ field: 'pan', operation: 'set', value: 0 }]); return;
			case 'mono_toggle': await submitMutations(tabId, [{ field: 'mono', operation: 'toggle' }]); return;
			case 'fullscreen_toggle': await submitMutations(tabId, [{ field: 'fullscreen', operation: 'toggle' }]); return;
			case 'pip_toggle': await submitMutations(tabId, [{ field: 'pip', operation: 'toggle' }]); return;
			case 'rotate_cw': await submitMutations(tabId, [{ field: 'rotation', operation: 'delta', value: 90 }]); return;
			case 'rotate_ccw': await submitMutations(tabId, [{ field: 'rotation', operation: 'delta', value: -90 }]); return;
			case 'mirror_toggle': await submitMutations(tabId, [{ field: 'mirrored', operation: 'toggle' }]); return;
			case 'dim_background': await submitMutations(tabId, [{ field: 'dimEnabled', operation: 'toggle' }]); return;
			case 'loop_toggle': await submitMutations(tabId, [{ field: 'loop', operation: 'toggle' }]); return;
			case 'tab_pin': await submitMutations(tabId, [{ field: 'tabPinned', operation: 'toggle' }]); return;
			case 'tab_mute': await submitMutations(tabId, [{ field: 'tabMuted', operation: 'toggle' }]); return;
		}
	} catch (error) {
		swLog.warn(`Shortcut ${action} failed`, error);
	}
}
