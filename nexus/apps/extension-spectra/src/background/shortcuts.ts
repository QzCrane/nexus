// goal: handles global chrome keyboard shortcuts (manifest commands and custom slots)
// rule: standard commands are mapped directly; custom slots (slot_1-16) use user-defined mappings

import type { HotkeySettings, HotkeyAction } from '@nexus/contracts';
import { DEFAULT_HOTKEY_SETTINGS } from '@nexus/contracts';
import { swLog } from '../shared/logger';
import { sendSpectraTabRequest } from '../shared/spectra-client';
import { settingsRepository } from './settings-repository';
import { hotkeyTargetRepository } from './hotkey-target-repository';

// slotMapping: active mapping of manifest slot IDs to functional hotkey actions
let slotMapping: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEY_SETTINGS.slots };


// eff: synchronizes slotMapping from the background-owned settings repository
async function loadSlotMapping(): Promise<void> {
	try {
		updateShortcutSettings((await settingsRepository.getSnapshot()).hotkeySettings);
	} catch { }
}

export function updateShortcutSettings(settings: HotkeySettings): void {
	slotMapping = { ...settings.slots };
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
			if (target.url && /^https?:|^file:/u.test(target.url)) return target;
		} catch {
			await hotkeyTargetRepository.clearIfMatches(targetId);
		}
	}
	const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
	return active;
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

// eff: forwards the hotkey action to the content script for execution
// rule: content script handles all state updates using its real-time config, ensuring UI sync
async function executeAction(action: HotkeyAction, tabId: number, _domain: string): Promise<void> {
	try {
		await sendSpectraTabRequest(tabId, 'spectra.hotkey.trigger', { action });
	} catch { }
}
