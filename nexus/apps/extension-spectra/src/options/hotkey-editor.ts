/**
 * SPECTRA Options - 快捷键编辑器
 */

import type { HotkeyBinding, HotkeySettings } from '@nexus/contracts';
import { DEFAULT_MODIFIERS, PRESET_BINDINGS } from '@nexus/contracts';
import { openModal, formatKeyCombo } from './modal';

// DOM 元素
const listContainer = document.getElementById('hotkeys-list')!;
const emptyState = document.getElementById('hotkeys-empty')!;
const enabledToggle = document.getElementById('hotkeys-enabled') as HTMLInputElement;
const addBtn = document.getElementById('hotkeys-add')!;
const resetBtn = document.getElementById('hotkeys-reset')!;

// 当前配置
let settings: HotkeySettings = { enabled: true, bindings: [] };

/** 初始化快捷键编辑器 */
export async function initHotkeyEditor(): Promise<void> {
	// 加载配置
	await loadSettings();

	// 渲染列表
	renderList();

	// 事件绑定
	enabledToggle.addEventListener('change', handleToggleEnabled);
	addBtn.addEventListener('click', handleAdd);
	resetBtn.addEventListener('click', handleReset);
}

/** 加载配置 */
async function loadSettings(): Promise<void> {
	const result = await chrome.storage.local.get('hotkeySettings');
	if (result.hotkeySettings) {
		settings = result.hotkeySettings;
	} else {
		// 使用预设
		settings = { enabled: true, bindings: [...PRESET_BINDINGS] };
	}
	enabledToggle.checked = settings.enabled;
}

/** 保存配置 */
async function saveSettings(): Promise<void> {
	await chrome.storage.local.set({ hotkeySettings: settings });
	console.log('[SPECTRA] Hotkey settings saved');
}

/** 渲染列表 */
function renderList(): void {
	listContainer.innerHTML = '';

	if (settings.bindings.length === 0) {
		emptyState.classList.remove('hidden');
		return;
	}

	emptyState.classList.add('hidden');

	settings.bindings.forEach((binding, index) => {
		const item = createHotkeyItem(binding, index);
		listContainer.appendChild(item);
	});
}

/** 创建单个快捷键项 */
function createHotkeyItem(binding: HotkeyBinding, index: number): HTMLElement {
	const item = document.createElement('div');
	item.className = `hotkey-item${binding.enabled ? '' : ' disabled'}`;
	item.dataset.index = String(index);

	item.innerHTML = `
		<input type="checkbox" class="hotkey-enable" ${binding.enabled ? 'checked' : ''} />
		<div class="hotkey-key">${formatKeyCombo(binding.key)}</div>
		<div class="hotkey-action">${formatActionName(binding.action)}</div>
		<div class="hotkey-actions">
			<button class="edit" title="Edit">✏️</button>
			<button class="delete" title="Delete">🗑️</button>
		</div>
	`;

	// 启用切换
	const checkbox = item.querySelector('.hotkey-enable') as HTMLInputElement;
	checkbox.addEventListener('change', () => {
		binding.enabled = checkbox.checked;
		item.classList.toggle('disabled', !binding.enabled);
		saveSettings();
	});

	// 编辑
	const editBtn = item.querySelector('.edit')!;
	editBtn.addEventListener('click', () => {
		openModal(binding, (updated) => {
			settings.bindings[index] = updated;
			saveSettings();
			renderList();
		});
	});

	// 删除
	const deleteBtn = item.querySelector('.delete')!;
	deleteBtn.addEventListener('click', () => {
		settings.bindings.splice(index, 1);
		saveSettings();
		renderList();
	});

	return item;
}

/** 切换总开关 */
function handleToggleEnabled(): void {
	settings.enabled = enabledToggle.checked;
	saveSettings();
}

/** 添加新快捷键 */
function handleAdd(): void {
	const newBinding: HotkeyBinding = {
		id: `custom-${Date.now()}`,
		enabled: true,
		key: { code: '', modifiers: { ...DEFAULT_MODIFIERS } },
		action: 'none',
	};

	openModal(newBinding, (updated) => {
		settings.bindings.push(updated);
		saveSettings();
		renderList();
	});
}

/** 重置为预设 */
async function handleReset(): Promise<void> {
	if (!confirm('Reset all hotkeys to defaults?')) return;

	settings = { enabled: true, bindings: [...PRESET_BINDINGS] };
	await saveSettings();
	enabledToggle.checked = true;
	renderList();
}

/** 格式化动作名称 */
function formatActionName(action: string): string {
	return action
		.replace(/_/g, ' ')
		.replace(/\b\w/g, c => c.toUpperCase());
}
