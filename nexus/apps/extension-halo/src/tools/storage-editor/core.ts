// goal: Storage Editor core logic - read/write localStorage and sessionStorage

import type { StorageItem } from './types';

interface ScriptInjectionWithArgs<Args extends unknown[]> {
	target: chrome.scripting.InjectionTarget;
	func: (...args: Args) => void;
	args: Args;
}

async function executeScriptWithArgs<Args extends unknown[]>(injection: ScriptInjectionWithArgs<Args>): Promise<void> {
	// chrome-types 0.1.327 models `func` as zero-argument even though Chrome's
	// documented `args` ABI invokes it with the supplied tuple.
	await chrome.scripting.executeScript(injection as unknown as chrome.scripting.ScriptInjection);
}

// Get all storage items from page
export async function getStorageItems(): Promise<StorageItem[]> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return [];

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const items: Array<{ key: string; value: string; type: 'localStorage' | 'sessionStorage'; size: number }> = [];

				// localStorage
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key) {
						const value = localStorage.getItem(key) || '';
						items.push({ key, value, type: 'localStorage', size: value.length });
					}
				}

				// sessionStorage
				for (let i = 0; i < sessionStorage.length; i++) {
					const key = sessionStorage.key(i);
					if (key) {
						const value = sessionStorage.getItem(key) || '';
						items.push({ key, value, type: 'sessionStorage', size: value.length });
					}
				}

				return items;
			},
		});

		return result?.result || [];
	} catch {
		return [];
	}
}

// Set storage item
export async function setStorageItem(key: string, value: string, type: 'localStorage' | 'sessionStorage'): Promise<boolean> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return false;

		await executeScriptWithArgs({
			target: { tabId: tab.id },
			func: (k: string, v: string, t: StorageItem['type']) => {
				if (t === 'localStorage') localStorage.setItem(k, v);
				else sessionStorage.setItem(k, v);
			},
			args: [key, value, type],
		});

		return true;
	} catch {
		return false;
	}
}

// Delete storage item
export async function deleteStorageItem(key: string, type: 'localStorage' | 'sessionStorage'): Promise<boolean> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return false;

		await executeScriptWithArgs({
			target: { tabId: tab.id },
			func: (k: string, t: StorageItem['type']) => {
				if (t === 'localStorage') localStorage.removeItem(k);
				else sessionStorage.removeItem(k);
			},
			args: [key, type],
		});

		return true;
	} catch {
		return false;
	}
}

// Format size
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}
