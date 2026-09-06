// goal: Storage Editor core logic - read/write localStorage and sessionStorage
// rule: every mutation binds to the tab and origin that was scanned. The tab is
// never re-selected by "active tab" at effect time; a mismatch fails explicitly
// instead of writing into a different site.

import type { StorageItem } from './types';

interface ScriptInjectionWithArgs<Args extends unknown[]> {
	target: chrome.scripting.InjectionTarget;
	func: (...args: Args) => void;
	args: Args;
}

export interface StorageSnapshot {
	tabId: number;
	origin: string;
	items: StorageItem[];
}

async function executeScriptWithArgs<Args extends unknown[]>(injection: ScriptInjectionWithArgs<Args>): Promise<void> {
	// chrome-types 0.1.327 models `func` as zero-argument even though Chrome's
	// documented `args` ABI invokes it with the supplied tuple.
	await chrome.scripting.executeScript(injection as unknown as chrome.scripting.ScriptInjection);
}

function originOf(url: string | undefined): string {
	try { return new URL(url ?? '').origin; } catch { return ''; }
}

async function resolveBoundTab(target: StorageSnapshot): Promise<chrome.tabs.Tab> {
	// The bound tab must still exist and still show the scanned origin.
	const tab = await chrome.tabs.get(target.tabId);
	if (originOf(tab.pendingUrl ?? tab.url) !== target.origin) {
		throw new Error('The scanned page is no longer open in this tab. Rescan before editing.');
	}
	return tab;
}

// Get all storage items from the active tab and bind later edits to it
export async function scanActiveTabStorage(): Promise<StorageSnapshot> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) throw new Error('No active tab to scan.');
	const origin = originOf(tab.pendingUrl ?? tab.url);
	if (!origin) throw new Error('The active tab has no scannable web origin.');

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

	return { tabId: tab.id, origin, items: result?.result || [] };
}

// Set storage item on the bound tab
export async function setStorageItem(key: string, value: string, type: StorageItem['type'], target: StorageSnapshot): Promise<void> {
	await resolveBoundTab(target);
	await executeScriptWithArgs({
		target: { tabId: target.tabId },
		func: (k: string, v: string, t: StorageItem['type']) => {
			if (t === 'localStorage') localStorage.setItem(k, v);
			else sessionStorage.setItem(k, v);
		},
		args: [key, value, type],
	});
}

// Delete storage item on the bound tab
export async function deleteStorageItem(key: string, type: StorageItem['type'], target: StorageSnapshot): Promise<void> {
	await resolveBoundTab(target);
	await executeScriptWithArgs({
		target: { tabId: target.tabId },
		func: (k: string, t: StorageItem['type']) => {
			if (t === 'localStorage') localStorage.removeItem(k);
			else sessionStorage.removeItem(k);
		},
		args: [key, type],
	});
}

// Format size
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}
