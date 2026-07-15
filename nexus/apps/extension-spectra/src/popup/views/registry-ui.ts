// goal: manages the domain registry UI, allowing users to categorize domains as either 'restricted' (needs capture) or 'safe'

import { normalizeHostname, type DomainEntry, type RegistrySnapshot } from '@nexus/contracts';
import { $ } from '../utils/dom';
import type { I18NDict } from '../types';
import { addRegistryDomain, removeRegistryDomain } from '../../shared/registry-client';

type TabType = 'restricted' | 'safe';
type RegistryNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

interface RegistryUIElements {
	tabRestricted: HTMLButtonElement | null;
	tabSafe: HTMLButtonElement | null;
	filterInput: HTMLInputElement | null;
	listContainer: HTMLElement | null;
	newDomainInput: HTMLInputElement | null;
	btnAdd: HTMLButtonElement | null;
}

let currentTab: TabType = 'restricted';
let allEntries: DomainEntry[] = [];
let filterText = '';
let currentDict: I18NDict | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

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

// eff: filters registry entries based on the current search text and active category tab, then reconstructs the list DOM
function renderList(ui: RegistryUIElements): void {
	if (!ui.listContainer) return;

	const filtered = allEntries.filter(e => {
		// rule: 'restricted' domains must have the restricted property truthy; 'safe' domains must have it falsy
		const matchTab = currentTab === 'restricted' ? e.restricted !== false : e.restricted === false;
		const matchFilter = !filterText || e.domain.toLowerCase().includes(filterText.toLowerCase());
		return matchTab && matchFilter;
	});

	if (filtered.length === 0) {
		const emptyMsg = currentTab === 'restricted'
			? (currentDict?.registryEmptyRestricted ?? 'No sites need capture')
			: (currentDict?.registryEmptySafe ?? 'No safe sites');
		const empty = document.createElement('div');
		empty.className = 'registry-empty';
		empty.textContent = emptyMsg;
		ui.listContainer.replaceChildren(empty);
		return;
	}

	const fragment = document.createDocumentFragment();
	const deleteLabel = currentDict?.tipDelete || 'Delete';
	for (const entry of filtered) {
		const item = document.createElement('div');
		item.className = 'registry-item';

		const domain = document.createElement('span');
		domain.className = 'registry-item-domain';
		domain.textContent = entry.domain;

		const source = document.createElement('span');
		source.className = 'registry-item-source';
		source.textContent = entry.source === 'auto' ? 'AUTO' : 'USER';

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.className = 'registry-item-delete';
		deleteButton.title = deleteLabel;
		deleteButton.setAttribute('aria-label', `${deleteLabel}: ${entry.domain}`);
		deleteButton.textContent = '×';
		deleteButton.addEventListener('click', () => deleteDomain(entry.domain, ui));

		item.append(domain, source, deleteButton);
		fragment.append(item);
	}
	ui.listContainer.replaceChildren(fragment);
}

function applyMutation(
	operation: () => Promise<RegistrySnapshot>,
	ui: RegistryUIElements,
): Promise<void> {
	const task = async () => {
		const snapshot = await operation();
		allEntries.splice(0, allEntries.length, ...snapshot.entries);
		renderList(ui);
	};
	const result = mutationQueue.then(task, task);
	mutationQueue = result.catch(() => undefined);
	return result;
}

function deleteDomain(domain: string, ui: RegistryUIElements): void {
	void applyMutation(() => removeRegistryDomain(domain), ui).catch(() => undefined);
}

// eff: normalizes the domain input and adds it to the in-memory registry with a specific category tag
function addDomain(domain: string, ui: RegistryUIElements): void {
	const cleaned = normalizeHostname(domain);
	if (!cleaned) return;

	const restricted = currentTab === 'restricted';
	void applyMutation(() => addRegistryDomain(cleaned, restricted), ui)
		.then(() => {
			if (ui.newDomainInput?.value === domain) ui.newDomainInput.value = '';
		})
		.catch(() => undefined);
}

function switchTab(tab: TabType, ui: RegistryUIElements): void {
	currentTab = tab;

	for (const [type, button] of [
		['restricted', ui.tabRestricted],
		['safe', ui.tabSafe],
	] as const) {
		if (!button) continue;
		const selected = type === tab;
		button.classList.toggle('active', selected);
		button.setAttribute('aria-selected', String(selected));
		button.tabIndex = selected ? 0 : -1;
	}
	ui.listContainer?.setAttribute('aria-labelledby', tab === 'restricted' ? 'tab-restricted' : 'tab-safe');

	renderList(ui);
}

export function resolveRegistryNavigationKey(
	current: TabType,
	key: string,
): TabType | null {
	if (key === 'Home') return 'restricted';
	if (key === 'End') return 'safe';
	if (key === 'ArrowLeft' || key === 'ArrowRight') {
		return current === 'restricted' ? 'safe' : 'restricted';
	}
	return null;
}

function handleTabKeydown(event: KeyboardEvent, tab: TabType, ui: RegistryUIElements): void {
	const next = resolveRegistryNavigationKey(tab, event.key as RegistryNavigationKey);
	if (!next) return;
	event.preventDefault();
	switchTab(next, ui);
	(next === 'restricted' ? ui.tabRestricted : ui.tabSafe)?.focus();
}

// goal: bootstraps listeners for search input, category switching, and new domain addition
export function initRegistryUI(entries: DomainEntry[]): void {
	allEntries = entries;
	const ui = getUIElements();

	switchTab(currentTab, ui);

	ui.tabRestricted?.addEventListener('click', () => switchTab('restricted', ui));
	ui.tabSafe?.addEventListener('click', () => switchTab('safe', ui));
	ui.tabRestricted?.addEventListener('keydown', (event) => handleTabKeydown(event, 'restricted', ui));
	ui.tabSafe?.addEventListener('keydown', (event) => handleTabKeydown(event, 'safe', ui));

	ui.filterInput?.addEventListener('input', (e) => {
		filterText = (e.target as HTMLInputElement).value;
		renderList(ui);
	});

	ui.btnAdd?.addEventListener('click', () => {
		if (ui.newDomainInput) addDomain(ui.newDomainInput.value, ui);
	});

	ui.newDomainInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && ui.newDomainInput) {
			addDomain(ui.newDomainInput.value, ui);
		}
	});
}

// post: updates the localized UI dictionary and triggers a list rerender to update tooltips and empty states
export function updateRegistryI18n(dict: I18NDict): void {
	currentDict = dict;
	const ui = getUIElements();
	renderList(ui);
}
