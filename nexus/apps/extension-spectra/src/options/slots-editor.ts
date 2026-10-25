// goal: manages the mapping between Chrome command 'slots' (from manifest.json) and SPECTRA hotkey actions

import type { HotkeySettings, HotkeyAction } from '@nexus/contracts';
import {
	DEFAULT_HOTKEY_SETTINGS,
	HOTKEY_ACTIONS,
	type SettingsUiSnapshot,
} from '@nexus/contracts/ui-settings-runtime';
import { t, tf, getActionName, getCurrentLang, onLangChange } from './i18n';
import {
	getOptionsSettingsSnapshot,
	patchOptionsSettings,
} from '../shared/options-settings-client';
import { LatestKeyedIntentRegistry } from './latest-keyed-intent';
import { isSlotHotkeyAction } from './supported-hotkey-actions';
import { clearOptionsError, showOptionsError } from './status';

function cloneHotkeySettings(source: HotkeySettings): HotkeySettings {
	return {
		...source,
		slots: { ...source.slots },
		sites: { ...source.sites },
		disabledLegacyBindings: [...(source.disabledLegacyBindings ?? [])],
	};
}

let settings: HotkeySettings = cloneHotkeySettings(DEFAULT_HOTKEY_SETTINGS);
let presetCommands: string[] = [];
let slotCommands: string[] = [];
const pendingSlotMutations = new LatestKeyedIntentRegistry<string, HotkeyAction | null>();
let langBound = false;

// eff: initializes the slots editor by loading persistence state and establishing an i18n re-render listener
// inv: retry re-renders current state but never registers a second language listener
export async function initSlotsEditor(initialSnapshot?: SettingsUiSnapshot): Promise<void> {
	loadCommandRegistry();
	if (initialSnapshot) acceptSettingsSnapshot(initialSnapshot);
	else await loadSettings();
	renderSlots();
	if (langBound) return;
	langBound = true;
	onLangChange(renderSlots);
}

// The explicit extension manifest is the sole owner of configurable command
// names. chrome.commands.getAll() also returns Chromium's implicit
// `_execute_action`, which must not become a user-facing Options row.
function loadCommandRegistry(): void {
	const names = Object.keys(chrome.runtime.getManifest().commands ?? {});
	presetCommands = names.filter((name) => !name.startsWith('slot_'));
	slotCommands = names.filter((name) => name.startsWith('slot_'));
}

function acceptSettingsSnapshot(snapshot: SettingsUiSnapshot): void {
	settings = cloneHotkeySettings(snapshot.hotkeySettings);
	for (const [command, pending] of pendingSlotMutations.entries()) {
		if (pending.value === null) delete settings.slots[command];
		else settings.slots[command] = pending.value;
	}
}

async function loadSettings(forceRefresh = false): Promise<void> {
	acceptSettingsSnapshot(await getOptionsSettingsSnapshot(forceRefresh));
	clearOptionsError();
}

export function projectSlotsEditor(snapshot: SettingsUiSnapshot): void {
	acceptSettingsSnapshot(snapshot);
	renderSlots();
}

// eff: generates the UI list for both preset and generic command slots, populating them with localized action names
function renderSlots(): void {
	const container = document.getElementById('slots-list');
	if (!container) return;

	container.replaceChildren();

	presetCommands.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, true);
		container.appendChild(row);
	});

	slotCommands.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, false);
		container.appendChild(row);
	});
}

// eff: creates a single configuration row with a command label and an action selector
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
	select.setAttribute('aria-label', tf('slot_action_aria', { name: formatCommandName(command) }));

	const noneOpt = document.createElement('option');
	noneOpt.value = 'none';
	noneOpt.textContent = t('slot_unbound');
	select.appendChild(noneOpt);

	HOTKEY_ACTIONS.filter(a => a !== 'none' && isSlotHotkeyAction(a)).forEach(a => {
		const opt = document.createElement('option');
		opt.value = a;
		opt.textContent = formatActionName(a);
		if (a === action) opt.selected = true;
		select.appendChild(opt);
	});

	if (!isSlotHotkeyAction(action)) {
		const legacy = document.createElement('option');
		legacy.value = action;
		legacy.textContent = `${formatActionName(action)} — ${t('slot_unavailable_suffix')}`;
		legacy.disabled = true;
		legacy.selected = true;
		select.prepend(legacy);
		select.title = t('slot_unavailable_title');
	}

	if (action !== 'none') {
		select.value = action;
	}

	select.addEventListener('change', async () => {
		const selectedAction = select.value as HotkeyAction;
		// The visible `none` option is a UI sentinel; the wire contract uses null
		// so the repository removes the command instead of persisting an invalid action.
		const action = selectedAction === 'none' ? null : selectedAction;
		const token = pendingSlotMutations.begin(command, action);
		if (action === null) delete settings.slots[command];
		else settings.slots[command] = action;
		await pendingSlotMutations.settle(
			command,
			token,
			patchOptionsSettings({ scope: 'hotkey-slots', changes: { [command]: action } }),
			{
				project: projectSlotsEditor,
				recover: () => getOptionsSettingsSnapshot(true),
				onError: showOptionsError,
			},
		);
	});

	row.appendChild(select);

	return row;
}

function formatCommandName(cmd: string): string {
	if (cmd.startsWith('slot_')) {
		return `Slot ${parseInt(cmd.slice(5), 10)}`;
	}
	return cmd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatActionName(action: string): string {
	return getActionName(action, getCurrentLang());
}
