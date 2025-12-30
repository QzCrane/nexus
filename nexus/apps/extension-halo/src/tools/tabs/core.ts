
// goal: Core logic for Tab Manager (chrome.tabs wrapper)
// scope: module

import { TabItem } from './types';

// Convert chrome.tabs.Tab to our TabItem
function toTabItem(tab: chrome.tabs.Tab): TabItem {
	return {
		id: tab.id || 0,
		windowId: tab.windowId,
		title: tab.title || 'Untitled',
		url: tab.url || '',
		favIconUrl: tab.favIconUrl,
		active: tab.active,
		pinned: tab.pinned,
		audible: tab.audible,
		mutedInfo: tab.mutedInfo
	};
}

// Fetch all tabs from the current window
export async function getTabs(): Promise<TabItem[]> {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	return tabs.map(toTabItem);
}

// Switch to a specific tab
export async function activateTab(tabId: number): Promise<void> {
	await chrome.tabs.update(tabId, { active: true });
}

// Close a specific tab
export async function closeTab(tabId: number): Promise<void> {
	await chrome.tabs.remove(tabId);
}

// Create a new tab
export async function createTab(url?: string): Promise<void> {
	await chrome.tabs.create({ url });
}

// Listen for tab changes and trigger callback
export function setupTabListeners(onChange: () => void): () => void {
	const events = [
		chrome.tabs.onCreated,
		chrome.tabs.onUpdated,
		chrome.tabs.onRemoved,
		chrome.tabs.onActivated,
		chrome.tabs.onMoved,
		chrome.tabs.onReplaced
	];

	const handler = () => onChange();

	// Debounce checking could be added here if needed, but for now simple callback
	events.forEach(event => event.addListener(handler));

	return () => {
		events.forEach(event => event.removeListener(handler));
	};
}
