/**
 * SPECTRA Options - Chrome Slots Editor
 *
 * Configure Chrome Command Slot -> Action mapping
 */

import type { HotkeySettings, HotkeyAction } from '@nexus/contracts';
import { HOTKEY_ACTIONS, DEFAULT_HOTKEY_SETTINGS } from '@nexus/contracts';
import { t, getActionName, getCurrentLang, onLangChange } from './i18n';

// Preset commands (defined in manifest.json)
const PRESET_COMMANDS = ['volume_up', 'volume_down', 'toggle_mute', 'speed_up'];
const SLOT_COMMANDS = Array.from({ length: 16 }, (_, i) => `slot_${String(i + 1).padStart(2, '0')}`);

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };

export async function initSlotsEditor(): Promise<void> {
	await loadSettings();
	renderSlots();
	onLangChange(renderSlots);
}

async function loadSettings(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('hotkeySettings');
		if (result.hotkeySettings) {
			settings = { ...DEFAULT_HOTKEY_SETTINGS, ...result.hotkeySettings };
		}
	} catch { /* ignore */ }
}

async function saveSettings(): Promise<void> {
	await chrome.storage.local.set({ hotkeySettings: settings });
}

function renderSlots(): void {
	const container = document.getElementById('slots-list');
	if (!container) return;

	container.innerHTML = '';

	// Preset Commands (Read-only, show bound action)
	PRESET_COMMANDS.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, true);
		container.appendChild(row);
	});

	// Custom Slots (Editable)
	SLOT_COMMANDS.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, false);
		container.appendChild(row);
	});
}

function createSlotRow(command: string, action: HotkeyAction, readonly: boolean): HTMLElement {
	const row = document.createElement('div');
	row.className = 'slot-row';

	const nameEl = document.createElement('span');
	nameEl.className = 'slot-name';
	nameEl.textContent = formatCommandName(command);
	row.appendChild(nameEl);

	const select = document.createElement('select');
	select.className = 'slot-action-select';
	select.disabled = readonly;

	const noneOpt = document.createElement('option');
	noneOpt.value = 'none';
	noneOpt.textContent = t('slot_unbound');
	select.appendChild(noneOpt);

	HOTKEY_ACTIONS.filter(a => a !== 'none').forEach(a => {
		const opt = document.createElement('option');
		opt.value = a;
		opt.textContent = formatActionName(a);
		if (a === action) opt.selected = true;
		select.appendChild(opt);
	});

	if (action !== 'none') {
		select.value = action;
	}

	select.addEventListener('change', async () => {
		settings.slots[command] = select.value as HotkeyAction;
		await saveSettings();
	});

	row.appendChild(select);

	return row;
}

function formatCommandName(cmd: string): string {
	if (cmd.startsWith('slot_')) {
		return `Slot ${parseInt(cmd.slice(5))}`;
	}
	return cmd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatActionName(action: string): string {
	return getActionName(action, getCurrentLang());
}
