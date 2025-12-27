/**
 * SPECTRA Options - Chrome Slots 编辑器
 * 
 * 配置 Chrome Command Slot → Action 映射
 */

import type { HotkeySettings, HotkeyAction } from '@nexus/contracts';
import { HOTKEY_ACTIONS, DEFAULT_HOTKEY_SETTINGS } from '@nexus/contracts';
import { t } from './i18n';

// 预设命令 (manifest.json 中定义)
const PRESET_COMMANDS = ['volume_up', 'volume_down', 'toggle_mute', 'speed_up'];
const SLOT_COMMANDS = Array.from({ length: 16 }, (_, i) => `slot_${String(i + 1).padStart(2, '0')}`);

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };

/** 初始化 Slots 编辑器 */
export async function initSlotsEditor(): Promise<void> {
	await loadSettings();
	renderSlots();
}

/** 加载设置 */
async function loadSettings(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('hotkeySettings');
		if (result.hotkeySettings) {
			settings = { ...DEFAULT_HOTKEY_SETTINGS, ...result.hotkeySettings };
		}
	} catch { /* ignore */ }
}

/** 保存设置 */
async function saveSettings(): Promise<void> {
	await chrome.storage.local.set({ hotkeySettings: settings });
}

/** 渲染 Slots 列表 */
function renderSlots(): void {
	const container = document.getElementById('slots-list');
	if (!container) return;

	container.innerHTML = '';

	// 预设命令 (只读，显示当前绑定的 action)
	PRESET_COMMANDS.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, true);
		container.appendChild(row);
	});

	// 自定义 Slots (可编辑)
	SLOT_COMMANDS.forEach(cmd => {
		const action = settings.slots[cmd] ?? 'none';
		const row = createSlotRow(cmd, action, false);
		container.appendChild(row);
	});
}

/** 创建 Slot 行 */
function createSlotRow(command: string, action: HotkeyAction, readonly: boolean): HTMLElement {
	const row = document.createElement('div');
	row.className = 'slot-row';

	// 命令名
	const nameEl = document.createElement('span');
	nameEl.className = 'slot-name';
	nameEl.textContent = formatCommandName(command);
	row.appendChild(nameEl);

	// Action 选择器
	const select = document.createElement('select');
	select.className = 'slot-action-select';
	select.disabled = readonly;

	// None 选项
	const noneOpt = document.createElement('option');
	noneOpt.value = 'none';
	noneOpt.textContent = t('slot_unbound');
	select.appendChild(noneOpt);

	// 所有动作
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

/** 格式化命令名 */
function formatCommandName(cmd: string): string {
	if (cmd.startsWith('slot_')) {
		return `Slot ${parseInt(cmd.slice(5))}`;
	}
	return cmd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** 格式化动作名 */
function formatActionName(action: string): string {
	return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
