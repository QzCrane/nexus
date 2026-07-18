// goal: manages one media-fingerprint-to-route table with no duplicate domain lists

import {
	normalizeHostname,
	type DomainEntry,
	type MediaRoute,
	type RegistrySnapshot,
} from '@nexus/contracts';
import { $ } from '../utils/dom';
import type { I18NDict } from '../types';
import {
	addRegistryDomain,
	getRegistrySnapshot,
	removeRegistryDomain,
} from '../../shared/registry-client';

interface RegistryUIElements {
	filterInput: HTMLInputElement | null;
	listContainer: HTMLElement | null;
	newDomainInput: HTMLInputElement | null;
	routeSelect: HTMLSelectElement | null;
	btnAdd: HTMLButtonElement | null;
}

let allEntries: DomainEntry[] = [];
let filterText = '';
let currentDict: I18NDict | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
let storageListenerInstalled = false;

function getUIElements(): RegistryUIElements {
	return {
		filterInput: $<HTMLInputElement>('registry-filter'),
		listContainer: $<HTMLElement>('registry-list'),
		newDomainInput: $<HTMLInputElement>('registry-new-domain'),
		routeSelect: $<HTMLSelectElement>('registry-new-route'),
		btnAdd: $<HTMLButtonElement>('btn-add-domain'),
	};
}

function routeLabel(route: MediaRoute): string {
	if (route === 'capture') return currentDict?.tabRestricted ?? 'Capture when needed';
	return currentDict?.tabSafe ?? 'Direct';
}

function fingerprintLabel(entry: DomainEntry): string {
	if (entry.fingerprint.startsWith('site:')) return 'SITE';
	return entry.fingerprint.slice('media:v1:'.length);
}

function renderList(ui: RegistryUIElements): void {
	if (!ui.listContainer) return;
	const query = filterText.trim().toLowerCase();
	const filtered = allEntries
		.filter((entry) => !query
			|| entry.domain.toLowerCase().includes(query)
			|| entry.fingerprint.toLowerCase().includes(query)
			|| entry.route.includes(query))
		.sort((left, right) => right.updatedAt - left.updatedAt);

	if (filtered.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'registry-empty';
		empty.textContent = currentDict?.registryEmptyRestricted ?? 'No cached media routes';
		ui.listContainer.replaceChildren(empty);
		return;
	}

	const fragment = document.createDocumentFragment();
	const deleteLabel = currentDict?.tipDelete || 'Delete';
	for (const entry of filtered) {
		const item = document.createElement('li');
		item.className = 'registry-item';

		const identity = document.createElement('div');
		identity.className = 'registry-item-identity';
		const domain = document.createElement('span');
		domain.className = 'registry-item-domain';
		domain.textContent = entry.domain;
		const fingerprint = document.createElement('code');
		fingerprint.className = 'registry-item-fingerprint';
		fingerprint.textContent = fingerprintLabel(entry);
		fingerprint.title = entry.fingerprint;
		identity.append(domain, fingerprint);

		const route = document.createElement('span');
		route.className = `registry-item-route registry-item-route-${entry.route}`;
		route.textContent = routeLabel(entry.route);

		const source = document.createElement('span');
		source.className = 'registry-item-source';
		source.textContent = entry.source === 'auto' ? 'AUTO' : 'USER';

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.className = 'registry-item-delete';
		deleteButton.title = deleteLabel;
		deleteButton.setAttribute('aria-label', `${deleteLabel}: ${entry.domain} ${fingerprintLabel(entry)}`);
		deleteButton.textContent = '×';
		deleteButton.addEventListener('click', () => deleteEntry(entry.fingerprint, ui));

		item.append(identity, route, source, deleteButton);
		fragment.append(item);
	}
	ui.listContainer.replaceChildren(fragment);
}

function replaceSnapshot(snapshot: RegistrySnapshot, ui: RegistryUIElements): void {
	allEntries.splice(0, allEntries.length, ...snapshot.entries);
	renderList(ui);
}

function applyMutation(
	operation: () => Promise<RegistrySnapshot>,
	ui: RegistryUIElements,
): Promise<void> {
	const task = async () => replaceSnapshot(await operation(), ui);
	const result = mutationQueue.then(task, task);
	mutationQueue = result.catch(() => undefined);
	return result;
}

function refreshSnapshot(ui: RegistryUIElements): void {
	void getRegistrySnapshot()
		.then((snapshot) => replaceSnapshot(snapshot, ui))
		.catch(() => undefined);
}

function deleteEntry(fingerprint: string, ui: RegistryUIElements): void {
	void applyMutation(() => removeRegistryDomain(fingerprint), ui).catch(() => undefined);
}

function addDomain(domain: string, route: MediaRoute, ui: RegistryUIElements): void {
	const cleaned = normalizeHostname(domain);
	if (!cleaned) return;
	void applyMutation(() => addRegistryDomain(cleaned, route), ui)
		.then(() => {
			if (ui.newDomainInput?.value === domain) ui.newDomainInput.value = '';
		})
		.catch(() => undefined);
}

export function initRegistryUI(entries: DomainEntry[]): void {
	allEntries = entries;
	const ui = getUIElements();
	renderList(ui);
	refreshSnapshot(ui);

	ui.filterInput?.addEventListener('input', (event) => {
		filterText = (event.target as HTMLInputElement).value;
		renderList(ui);
	});

	const submit = () => {
		if (!ui.newDomainInput) return;
		const route: MediaRoute = ui.routeSelect?.value === 'direct' ? 'direct' : 'capture';
		addDomain(ui.newDomainInput.value, route, ui);
	};
	ui.btnAdd?.addEventListener('click', submit);
	ui.newDomainInput?.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') submit();
	});

	if (!storageListenerInstalled && chrome.storage?.onChanged) {
		storageListenerInstalled = true;
		const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
			if (areaName === 'local' && changes.mediaRouteRegistry) refreshSnapshot(ui);
		};
		chrome.storage.onChanged.addListener(listener);
		window.addEventListener('unload', () => chrome.storage.onChanged.removeListener(listener), { once: true });
	}
}

export function updateRegistryI18n(dict: I18NDict): void {
	currentDict = dict;
	renderList(getUIElements());
}
