/**
 * SPECTRA Options - 网站配置编辑器
 * 
 * 为特定网站配置独立快捷键 (默认关闭)
 */

import type { HotkeySettings, HotkeyBinding } from '@nexus/contracts';
import { DEFAULT_HOTKEY_SETTINGS, DEFAULT_MODIFIERS } from '@nexus/contracts';
import { openModal } from './modal';

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };
let selectedSite: string | null = null;

/** 初始化网站配置编辑器 */
export async function initSiteEditor(): Promise<void> {
	await loadSettings();
	renderSiteSelector();
	bindEvents();
}

/** 加载设置 */
async function loadSettings(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('hotkeySettings');
		if (result.hotkeySettings) settings = { ...DEFAULT_HOTKEY_SETTINGS, ...result.hotkeySettings };
	} catch { /* ignore */ }
}

/** 保存设置 */
async function saveSettings(): Promise<void> {
	await chrome.storage.local.set({ hotkeySettings: settings });
}

/** 渲染网站选择器 */
function renderSiteSelector(): void {
	const select = document.getElementById('site-select') as HTMLSelectElement | null;
	if (!select) return;
	while (select.options.length > 1) select.remove(1);
	Object.keys(settings.sites).forEach(domain => {
		const opt = document.createElement('option');
		opt.value = domain;
		opt.textContent = domain;
		select.appendChild(opt);
	});
}

/** 绑定事件 */
function bindEvents(): void {
	const select = document.getElementById('site-select') as HTMLSelectElement | null;
	select?.addEventListener('change', () => select.value ? selectSite(select.value) : hideSiteConfig());

	document.getElementById('site-add-current')?.addEventListener('click', addCurrentSite);

	const enabledCb = document.getElementById('site-enabled') as HTMLInputElement | null;
	enabledCb?.addEventListener('change', async () => {
		if (selectedSite && settings.sites[selectedSite]) {
			settings.sites[selectedSite].enabled = enabledCb.checked;
			await saveSettings();
		}
	});

	document.getElementById('site-delete')?.addEventListener('click', deleteSite);
	document.getElementById('site-add-binding')?.addEventListener('click', () => {
		if (!selectedSite) return;
		openModal(null, (binding) => {
			const site = settings.sites[selectedSite!];
			if (site) { site.bindings.push(binding); saveSettings(); renderBindings(); }
		});
	});
}

/** 选择网站 */
function selectSite(domain: string): void {
	selectedSite = domain;
	const config = settings.sites[domain];
	if (!config) return;
	document.getElementById('site-config')?.classList.remove('hidden');
	document.getElementById('site-empty')?.classList.add('hidden');
	const domainEl = document.getElementById('site-domain');
	if (domainEl) domainEl.textContent = domain;
	const enabledCb = document.getElementById('site-enabled') as HTMLInputElement | null;
	if (enabledCb) enabledCb.checked = config.enabled;
	renderBindings();
}

/** 隐藏配置面板 */
function hideSiteConfig(): void {
	selectedSite = null;
	document.getElementById('site-config')?.classList.add('hidden');
	document.getElementById('site-empty')?.classList.remove('hidden');
}

/** 添加当前网站 */
async function addCurrentSite(): Promise<void> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.url) return;
		const domain = new URL(tab.url).hostname;
		if (!domain || settings.sites[domain]) { alert('Site already exists or invalid URL'); return; }
		settings.sites[domain] = { enabled: false, bindings: [] };
		await saveSettings();
		renderSiteSelector();
		const select = document.getElementById('site-select') as HTMLSelectElement | null;
		if (select) { select.value = domain; selectSite(domain); }
	} catch (e) { console.error('Failed to add site:', e); }
}

/** 删除网站 */
async function deleteSite(): Promise<void> {
	if (!selectedSite || !confirm(`Delete configuration for ${selectedSite}?`)) return;
	delete settings.sites[selectedSite];
	await saveSettings();
	renderSiteSelector();
	hideSiteConfig();
}

/** 渲染绑定列表 */
function renderBindings(): void {
	const container = document.getElementById('site-bindings-list');
	if (!container || !selectedSite) return;
	const config = settings.sites[selectedSite];
	if (!config) return;
	container.innerHTML = '';
	config.bindings.forEach((binding, index) => {
		const row = createBindingRow(binding, index);
		container.appendChild(row);
	});
}

/** 创建绑定行 */
function createBindingRow(binding: HotkeyBinding, index: number): HTMLElement {
	const row = document.createElement('div');
	row.className = 'binding-row';

	const keyEl = document.createElement('span');
	keyEl.className = 'binding-key';
	keyEl.textContent = formatKeyCombo(binding.key);
	row.appendChild(keyEl);

	const actionEl = document.createElement('span');
	actionEl.className = 'binding-action';
	actionEl.textContent = binding.action.replace(/_/g, ' ');
	row.appendChild(actionEl);

	const editBtn = document.createElement('button');
	editBtn.className = 'btn btn-small';
	editBtn.textContent = '✏️';
	editBtn.addEventListener('click', () => {
		openModal(binding, (updated) => {
			const site = settings.sites[selectedSite!];
			if (site) { site.bindings[index] = updated; saveSettings(); renderBindings(); }
		});
	});
	row.appendChild(editBtn);

	const delBtn = document.createElement('button');
	delBtn.className = 'btn btn-small btn-danger';
	delBtn.textContent = '🗑️';
	delBtn.addEventListener('click', async () => {
		const site = settings.sites[selectedSite!];
		if (site) { site.bindings.splice(index, 1); await saveSettings(); renderBindings(); }
	});
	row.appendChild(delBtn);

	return row;
}

/** 格式化按键组合 */
function formatKeyCombo(key: { code: string; modifiers: typeof DEFAULT_MODIFIERS }): string {
	const parts: string[] = [];
	if (key.modifiers.ctrl) parts.push('Ctrl');
	if (key.modifiers.alt) parts.push('Alt');
	if (key.modifiers.shift) parts.push('Shift');
	if (key.modifiers.meta) parts.push('Meta');
	parts.push(key.code.replace('Key', '').replace('Digit', ''));
	return parts.join('+');
}
