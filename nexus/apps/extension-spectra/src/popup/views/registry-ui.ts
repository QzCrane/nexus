/**
 * SPECTRA Popup - 注册表 UI 控制器
 * 
 * 职责：管理注册表列表的展示和交互
 */

import type { DomainEntry } from '@nexus/contracts';
import { $ } from '../utils/dom';
import type { I18NDict } from '../types';

/** 当前显示的标签页 */
type TabType = 'restricted' | 'safe';

/** UI 元素引用 */
interface RegistryUIElements {
	tabRestricted: HTMLButtonElement | null;
	tabSafe: HTMLButtonElement | null;
	filterInput: HTMLInputElement | null;
	listContainer: HTMLElement | null;
	newDomainInput: HTMLInputElement | null;
	btnAdd: HTMLButtonElement | null;
}

/** 状态 */
let currentTab: TabType = 'restricted';
let allEntries: DomainEntry[] = [];
let filterText = '';
let currentDict: I18NDict | null = null;

/** 获取 UI 元素 */
function getUIElements(): RegistryUIElements {
	return {
		tabRestricted: $<HTMLButtonElement>('tab-restricted'),
		tabSafe: $<HTMLButtonElement>('tab-safe'),
		filterInput: $<HTMLInputElement>('registry-filter'),
		listContainer: $<HTMLElement>('registry-list'),
		newDomainInput: $<HTMLInputElement>('registry-new-domain'),
		btnAdd: $<HTMLButtonElement>('btn-add-domain'),
	};
}

/** 渲染列表 */
function renderList(ui: RegistryUIElements): void {
	if (!ui.listContainer) return;

	// 过滤和筛选
	const filtered = allEntries.filter(e => {
		const matchTab = currentTab === 'restricted' ? e.restricted !== false : e.restricted === false;
		const matchFilter = !filterText || e.domain.toLowerCase().includes(filterText.toLowerCase());
		return matchTab && matchFilter;
	});

	if (filtered.length === 0) {
		const emptyMsg = currentTab === 'restricted'
			? (currentDict?.registryEmptyRestricted ?? 'No sites need capture')
			: (currentDict?.registryEmptySafe ?? 'No safe sites');
		ui.listContainer.innerHTML = `<div class="registry-empty">${emptyMsg}</div>`;
		return;
	}

	ui.listContainer.innerHTML = filtered.map(e => `
		<div class="registry-item" data-domain="${e.domain}">
			<span class="registry-item-domain">${e.domain}</span>
			<span class="registry-item-source">${e.source === 'auto' ? 'AUTO' : 'USER'}</span>
			<button class="registry-item-delete" title="${currentDict?.tipDelete || 'Delete'}">×</button>
		</div>
	`).join('');

	// 绑定删除事件
	ui.listContainer.querySelectorAll('.registry-item-delete').forEach(btn => {
		btn.addEventListener('click', (e) => {
			const item = (e.target as HTMLElement).closest('.registry-item') as HTMLElement;
			const domain = item?.dataset.domain;
			if (domain) deleteDomain(domain, ui);
		});
	});
}

/** 删除域名 */
function deleteDomain(domain: string, ui: RegistryUIElements): void {
	allEntries = allEntries.filter(e => e.domain !== domain);
	saveAndRender(ui);
}

/** 添加域名 */
function addDomain(domain: string, ui: RegistryUIElements): void {
	const cleaned = domain.trim().toLowerCase();
	if (!cleaned) return;

	// 检查重复
	if (allEntries.some(e => e.domain === cleaned)) return;

	allEntries.push({
		domain: cleaned,
		source: 'user',
		restricted: currentTab === 'restricted',
		probed: false,
		addedAt: Date.now(),
	});

	saveAndRender(ui);

	// 清空输入
	if (ui.newDomainInput) ui.newDomainInput.value = '';
}

/** 保存并重新渲染 */
function saveAndRender(ui: RegistryUIElements): void {
	chrome.storage.local.set({ restrictedRegistry: allEntries });
	renderList(ui);
}

/** 切换标签页 */
function switchTab(tab: TabType, ui: RegistryUIElements): void {
	currentTab = tab;

	// 更新按钮样式
	if (ui.tabRestricted) ui.tabRestricted.classList.toggle('active', tab === 'restricted');
	if (ui.tabSafe) ui.tabSafe.classList.toggle('active', tab === 'safe');

	renderList(ui);
}

/**
 * 初始化注册表 UI
 * @param entries 初始数据
 */
export function initRegistryUI(entries: DomainEntry[]): void {
	allEntries = entries;
	const ui = getUIElements();

	// 初始渲染
	renderList(ui);

	// 标签页切换
	ui.tabRestricted?.addEventListener('click', () => switchTab('restricted', ui));
	ui.tabSafe?.addEventListener('click', () => switchTab('safe', ui));

	// 搜索过滤
	ui.filterInput?.addEventListener('input', (e) => {
		filterText = (e.target as HTMLInputElement).value;
		renderList(ui);
	});

	// 添加域名
	ui.btnAdd?.addEventListener('click', () => {
		if (ui.newDomainInput) addDomain(ui.newDomainInput.value, ui);
	});

	ui.newDomainInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && ui.newDomainInput) {
			addDomain(ui.newDomainInput.value, ui);
		}
	});
}

/**
 * 更新注册表 UI 的 i18n
 * @param dict 语言字典
 */
export function updateRegistryI18n(dict: I18NDict): void {
	currentDict = dict;
	const ui = getUIElements();
	renderList(ui);
}
