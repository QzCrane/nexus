// goal: UserScripts injection engine - runs in background service worker

import type { UserScript } from './types';
import { getUserScriptsState, getMatchingScripts } from './core';

const LOG_TAG = '[HALO:UserScripts]';

// Initialize injection on tab updates
export function initUserScriptsEngine(): void {
	console.log(LOG_TAG, 'Engine initialized');

	// Check if optional permission is granted
	if (!chrome.webNavigation) {
		console.log(LOG_TAG, 'webNavigation permission not active, skipping listeners');
		return;
	}

	// Listen for navigation complete
	chrome.webNavigation.onCompleted.addListener(async (details) => {
		// Skip frames, only main frame
		if (details.frameId !== 0) return;

		const state = await getUserScriptsState();
		if (!state.globalEnabled) return;

		const matchingScripts = getMatchingScripts(state.scripts, details.url);
		if (matchingScripts.length === 0) return;

		// Filter by document_end (default for onCompleted)
		const endScripts = matchingScripts.filter((s) => s.runAt === 'document_end' || s.runAt === 'document_idle');
		await injectScripts(details.tabId, endScripts);
	});

	// Listen for document_start injection
	chrome.webNavigation.onCommitted.addListener(async (details) => {
		if (details.frameId !== 0) return;

		const state = await getUserScriptsState();
		if (!state.globalEnabled) return;

		const matchingScripts = getMatchingScripts(state.scripts, details.url);
		const startScripts = matchingScripts.filter((s) => s.runAt === 'document_start');
		if (startScripts.length > 0) {
			await injectScripts(details.tabId, startScripts);
		}
	});
}

// Inject scripts via chrome.scripting API
async function injectScripts(tabId: number, scripts: UserScript[]): Promise<void> {
	for (const script of scripts) {
		try {
			await chrome.scripting.executeScript({
				target: { tabId },
				func: executeUserScript,
				args: [script.code, script.name],
				world: 'MAIN',  // Run in page context for DOM access
			});
			console.log(LOG_TAG, `Injected: ${script.name}`);
		} catch (e) {
			console.warn(LOG_TAG, `Failed to inject ${script.name}:`, e);
		}
	}
}

// Wrapper function injected into page
function executeUserScript(code: string, name: string): void {
	try {
		// Create sandbox-like execution
		const fn = new Function(code);
		fn();
		console.log(`[HALO Script] ${name} executed`);
	} catch (e) {
		console.error(`[HALO Script] ${name} failed:`, e);
	}
}

// Manual injection for testing from panel
export async function injectScriptToCurrentTab(script: UserScript): Promise<boolean> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return false;

		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: executeUserScript,
			args: [script.code, script.name],
			world: 'MAIN',
		});
		return true;
	} catch (e) {
		console.warn(LOG_TAG, 'Manual injection failed:', e);
		return false;
	}
}
