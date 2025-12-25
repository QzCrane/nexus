/**
 * SPECTRA Popup - 域名预设管理 UI
 * 
 * 职责：管理 siteSettings 中保存的域名音量/EQ 预设
 */

import type { AudioConfig } from '@nexus/kernel';

/** 预设列表容器 */
let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let clearBtn: HTMLButtonElement | null = null;

/**
 * 初始化预设管理面板
 */
export function initPresetsUI(): void {
	listEl = document.getElementById('presets-list');
	emptyEl = document.getElementById('presets-empty');
	clearBtn = document.getElementById('btn-clear-presets') as HTMLButtonElement | null;

	// 绑定清空按钮
	if (clearBtn) {
		clearBtn.onclick = handleClearAll;
	}

	// 首次加载
	refreshPresetsList();
}

/**
 * 刷新预设列表
 */
async function refreshPresetsList(): Promise<void> {
	if (!listEl || !emptyEl) return;

	const presets = await loadAllPresets();
	const domains = Object.keys(presets);

	// 清空现有列表
	listEl.innerHTML = '';

	if (domains.length === 0) {
		listEl.style.display = 'none';
		emptyEl.style.display = 'block';
		if (clearBtn) clearBtn.style.display = 'none';
	} else {
		listEl.style.display = 'block';
		emptyEl.style.display = 'none';
		if (clearBtn) clearBtn.style.display = 'inline-block';

		// 渲染每个预设项
		domains.sort().forEach(domain => {
			const config = presets[domain];
			if (config) {
				const item = createPresetItem(domain, config);
				listEl!.appendChild(item);
			}
		});
	}
}

/**
 * 创建单个预设项元素
 */
function createPresetItem(domain: string, config: Partial<AudioConfig>): HTMLElement {
	const item = document.createElement('div');
	item.className = 'preset-item';

	// 域名
	const domainEl = document.createElement('span');
	domainEl.className = 'preset-domain';
	domainEl.textContent = domain;

	// 音量显示
	const volumeEl = document.createElement('span');
	volumeEl.className = 'preset-volume';
	volumeEl.textContent = config.volume !== undefined ? `${config.volume}%` : '—';

	// 删除按钮
	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'btn-preset-delete';
	deleteBtn.textContent = '✕';
	deleteBtn.title = 'Delete';
	deleteBtn.onclick = () => handleDeletePreset(domain);

	item.appendChild(domainEl);
	item.appendChild(volumeEl);
	item.appendChild(deleteBtn);

	return item;
}

/**
 * 删除单个预设
 */
async function handleDeletePreset(domain: string): Promise<void> {
	const result = await chrome.storage.local.get(['siteSettings']);
	const settings = (result.siteSettings as Record<string, Partial<AudioConfig>>) || {};

	delete settings[domain];
	await chrome.storage.local.set({ siteSettings: settings });

	refreshPresetsList();
}

/**
 * 清空所有预设
 */
async function handleClearAll(): Promise<void> {
	await chrome.storage.local.remove(['siteSettings']);
	refreshPresetsList();
}

/**
 * 加载所有预设
 */
async function loadAllPresets(): Promise<Record<string, Partial<AudioConfig>>> {
	const result = await chrome.storage.local.get(['siteSettings']);
	return (result.siteSettings as Record<string, Partial<AudioConfig>>) || {};
}
