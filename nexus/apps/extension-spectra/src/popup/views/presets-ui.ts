/**
 * SPECTRA Popup - Presets UI
 * 
 * Manages presets list and deletion.
 */

import type { AudioConfig } from '@nexus/kernel';
import type { I18NDict } from '../types';

let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let clearBtn: HTMLButtonElement | null = null;
let currentDict: I18NDict | null = null;

export function initPresetsUI(): void {
	listEl = document.getElementById('presets-list');
	emptyEl = document.getElementById('presets-empty');
	clearBtn = document.getElementById('btn-clear-presets') as HTMLButtonElement | null;

	if (clearBtn) {
		clearBtn.onclick = handleClearAll;
	}

	refreshPresetsList();
}

async function refreshPresetsList(): Promise<void> {
	if (!listEl || !emptyEl) return;

	const presets = await loadAllPresets();
	const domains = Object.keys(presets);

	listEl.innerHTML = '';

	if (domains.length === 0) {
		listEl.style.display = 'none';
		emptyEl.style.display = 'block';
		if (clearBtn) clearBtn.style.display = 'none';
	} else {
		listEl.style.display = 'block';
		emptyEl.style.display = 'none';
		if (clearBtn) clearBtn.style.display = 'inline-block';

		domains.sort().forEach(domain => {
			const config = presets[domain];
			if (config) {
				const item = createPresetItem(domain, config);
				listEl!.appendChild(item);
			}
		});
	}
}

function createPresetItem(domain: string, config: Partial<AudioConfig>): HTMLElement {
	const item = document.createElement('div');
	item.className = 'preset-item';

	const domainEl = document.createElement('span');
	domainEl.className = 'preset-domain';
	domainEl.textContent = domain;

	const volumeEl = document.createElement('span');
	volumeEl.className = 'preset-volume';
	volumeEl.textContent = config.volume !== undefined ? `${config.volume}%` : '—';

	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'btn-preset-delete';
	deleteBtn.textContent = '✕';
	deleteBtn.title = currentDict?.tipDelete || 'Delete';
	deleteBtn.onclick = () => handleDeletePreset(domain);

	item.appendChild(domainEl);
	item.appendChild(volumeEl);
	item.appendChild(deleteBtn);

	return item;
}

async function handleDeletePreset(domain: string): Promise<void> {
	const result = await chrome.storage.local.get(['siteSettings']);
	const settings = (result.siteSettings as Record<string, Partial<AudioConfig>>) || {};

	delete settings[domain];
	await chrome.storage.local.set({ siteSettings: settings });

	refreshPresetsList();
}

async function handleClearAll(): Promise<void> {
	await chrome.storage.local.remove(['siteSettings']);
	refreshPresetsList();
}

async function loadAllPresets(): Promise<Record<string, Partial<AudioConfig>>> {
	const result = await chrome.storage.local.get(['siteSettings']);
	return (result.siteSettings as Record<string, Partial<AudioConfig>>) || {};
}

export function updatePresetsI18n(dict: I18NDict): void {
	currentDict = dict;
	refreshPresetsList();
}
