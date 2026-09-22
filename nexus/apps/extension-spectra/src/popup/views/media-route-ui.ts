// goal: project and mutate the stable per-site direct/capture route registry

import {
	normalizeHostname,
	type DomainEntry,
	type MediaRoute,
} from '@nexus/contracts/registry-runtime';
import {
	addRegistryDomain,
	getRegistrySnapshot,
	removeRegistryDomain,
} from '../../shared/registry-client';
import {
	subscribeSettingsSnapshots,
} from '../../shared/settings-client';
import { showPopupToast } from '../toast';
import type { I18NDict } from '../types';

interface RouteElements {
	filter: HTMLInputElement;
	list: HTMLUListElement;
	domain: HTMLInputElement;
	route: HTMLSelectElement;
	add: HTMLButtonElement;
}

let currentDictionary: I18NDict | null = null;
let currentEntries: DomainEntry[] = [];
let disposeCurrent: (() => void) | null = null;
let currentSession = 0;
let mutationTail: Promise<void> = Promise.resolve();

const ROUTE_CLASS: Readonly<Record<MediaRoute, string>> = {
	direct: 'registry-item-route-direct',
	capture: 'registry-item-route-capture',
};

const SOURCE_CLASS: Readonly<Record<DomainEntry['source'], string>> = {
	auto: 'registry-item-source-auto',
	user: 'registry-item-source-user',
};

function requireElements(): RouteElements {
	const filter = document.querySelector<HTMLInputElement>('#registry-filter');
	const list = document.querySelector<HTMLUListElement>('#registry-list');
	const domain = document.querySelector<HTMLInputElement>('#registry-new-domain');
	const route = document.querySelector<HTMLSelectElement>('#registry-new-route');
	const add = document.querySelector<HTMLButtonElement>('#btn-add-domain');
	if (!filter || !list || !domain || !route || !add) {
		throw new Error('Site processing route controls are incomplete');
	}
	return { filter, list, domain, route, add };
}

function report(error: unknown): void {
	showPopupToast(error instanceof Error ? error.message : String(error), 'error');
}

function mutate(
	operation: () => Promise<{ entries: DomainEntry[] }>,
	elements: RouteElements,
	session: number,
): Promise<void> {
	const task = async (): Promise<void> => {
		const snapshot = await operation();
		if (session !== currentSession || !disposeCurrent) return;
		acceptEntries(snapshot.entries, elements);
	};
	const result = mutationTail.then(task, task);
	mutationTail = result.catch(() => undefined);
	return result;
}

function render(elements: RouteElements): void {
	const dictionary = currentDictionary;
	if (!dictionary) return;
	const query = elements.filter.value.trim().toLowerCase();
	const entries = currentEntries
		.filter((entry) => {
			const sourceLabel = entry.source === 'auto'
				? dictionary.registrySourceAuto
				: dictionary.registrySourceUser;
			return !query
				|| entry.domain.includes(query)
				|| entry.route.includes(query)
				|| sourceLabel.toLowerCase().includes(query);
		})
		.sort((left, right) => (
			right.updatedAt - left.updatedAt || left.domain.localeCompare(right.domain)
		));
	if (entries.length === 0) {
		const empty = document.createElement('li');
		empty.className = 'registry-empty';
		empty.textContent = dictionary.registryEmptyRestricted;
		elements.list.replaceChildren(empty);
		return;
	}
	const fragment = document.createDocumentFragment();
	for (const entry of entries) {
		const item = document.createElement('li');
		item.className = 'registry-item';
		const identity = document.createElement('div');
		identity.className = 'registry-item-identity';
		const domainLabel = document.createElement('span');
		domainLabel.className = 'registry-item-domain';
		domainLabel.textContent = entry.domain;
		const sourceLabel = document.createElement('span');
		sourceLabel.className = `registry-item-source ${SOURCE_CLASS[entry.source]}`;
		sourceLabel.textContent = entry.source === 'auto'
			? dictionary.registrySourceAuto
			: dictionary.registrySourceUser;
		identity.append(domainLabel, sourceLabel);
		const routeLabel = document.createElement('span');
		routeLabel.className = `registry-item-route ${ROUTE_CLASS[entry.route]}`;
		routeLabel.textContent = entry.route === 'capture' ? dictionary.tabRestricted : dictionary.tabSafe;
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'registry-item-delete';
		remove.textContent = '×';
		remove.title = dictionary.tipDelete;
		remove.setAttribute('aria-label', `${dictionary.tipDelete}: ${entry.domain}`);
		remove.addEventListener('click', () => {
			const session = currentSession;
			void mutate(
				() => removeRegistryDomain(entry.fingerprint),
				elements,
				session,
			)
				.catch(report);
		});
		item.append(identity, routeLabel, remove);
		fragment.append(item);
	}
	elements.list.replaceChildren(fragment);
}

function acceptEntries(entries: DomainEntry[], elements: RouteElements): void {
	currentEntries = entries;
	render(elements);
}

function refresh(elements: RouteElements, session: number): void {
	void getRegistrySnapshot()
		.then((snapshot) => {
			if (session !== currentSession || !disposeCurrent) return;
			acceptEntries(snapshot.entries, elements);
		})
		.catch(report);
}

export async function initMediaRouteUI(dictionary: I18NDict): Promise<() => void> {
	disposeCurrent?.();
	currentSession += 1;
	const session = currentSession;
	mutationTail = Promise.resolve();
	currentDictionary = dictionary;
	currentEntries = [];
	const elements = requireElements();
	const lifecycle = new AbortController();
	const { signal } = lifecycle;
	const submit = () => {
		const domain = normalizeHostname(elements.domain.value);
		if (!domain) {
			report(new Error(currentDictionary?.registryInvalidDomain ?? 'Invalid site hostname'));
			return;
		}
		const route: MediaRoute = elements.route.value === 'direct' ? 'direct' : 'capture';
		void mutate(
			() => addRegistryDomain(domain, route),
			elements,
			session,
		)
			.then(() => {
				if (session !== currentSession) return;
				if (normalizeHostname(elements.domain.value) === domain) elements.domain.value = '';
			})
			.catch(report);
	};
	elements.filter.addEventListener('input', () => render(elements), { signal });
	elements.add.addEventListener('click', submit, { signal });
	elements.domain.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') submit();
	}, { signal });
	const unsubscribe = subscribeSettingsSnapshots(() => refresh(elements, session));
	const onStorageChanged = (
		changes: Record<string, chrome.storage.StorageChange>,
		areaName: string,
	) => {
		if (areaName === 'local'
			&& (changes.siteProcessingRoutes || changes.mediaRouteRegistry)) {
			refresh(elements, session);
		}
	};
	chrome.storage.onChanged.addListener(onStorageChanged);
	const dispose = () => {
		if (session === currentSession) currentSession += 1;
		lifecycle.abort();
		unsubscribe();
		chrome.storage.onChanged.removeListener(onStorageChanged);
		if (disposeCurrent === dispose) disposeCurrent = null;
	};
	disposeCurrent = dispose;
	try {
		const snapshot = await getRegistrySnapshot();
		if (session === currentSession && disposeCurrent === dispose) {
			acceptEntries(snapshot.entries, elements);
		}
		return dispose;
	} catch (error) {
		dispose();
		throw error;
	}
}

export function updateMediaRouteI18n(dictionary: I18NDict): void {
	currentDictionary = dictionary;
	if (!disposeCurrent) return;
	render(requireElements());
}
