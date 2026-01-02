// goal: UserScripts injection engine - runs in background service worker
// eff: Supports JavaScript and CSS injection with run count tracking

import type { UserScript } from './types';
import { getUserScriptsState, getMatchingScripts, incrementRunCount } from './core';

const LOG_TAG = '[HALO:UserScripts]';

// Initialize injection on tab updates
export function initUserScriptsEngine(): void {
	console.log(LOG_TAG, 'Engine initialized');

	// Check if optional permission is granted
	if (!chrome.webNavigation) {
		console.log(LOG_TAG, 'webNavigation permission not active, skipping listeners');
		return;
	}

	// Listen for navigation complete (document_end, document_idle)
	chrome.webNavigation.onCompleted.addListener(async (details) => {
		if (details.frameId !== 0) return;

		const state = await getUserScriptsState();
		if (!state.globalEnabled) return;

		const matchingScripts = getMatchingScripts(state.scripts, details.url);
		if (matchingScripts.length === 0) return;

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
			if (script.type === 'css') {
				await injectCSS(tabId, script);
			} else {
				await injectJS(tabId, script);
			}
			// Update run count
			await incrementRunCount(script.id);
			console.log(LOG_TAG, `Injected: ${script.name} (${script.type})`);
		} catch (e) {
			console.warn(LOG_TAG, `Failed to inject ${script.name}:`, e);
		}
	}
}

// Inject JavaScript
async function injectJS(tabId: number, script: UserScript): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId },
		func: executeUserScript as () => void,
		args: [script.code, script.name],
		world: 'MAIN',
	} as chrome.scripting.ScriptInjection);
}

// Inject CSS
async function injectCSS(tabId: number, script: UserScript): Promise<void> {
	await chrome.scripting.insertCSS({
		target: { tabId },
		css: script.code,
	});
}

// Wrapper function injected into page
function executeUserScript(code: string, name: string): void {
	try {
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

		if (script.type === 'css') {
			await chrome.scripting.insertCSS({
				target: { tabId: tab.id },
				css: script.code,
			});
		} else {
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: executeUserScript as () => void,
				args: [script.code, script.name],
				world: 'MAIN',
			} as chrome.scripting.ScriptInjection);
		}

		await incrementRunCount(script.id);
		return true;
	} catch (e) {
		console.warn(LOG_TAG, 'Manual injection failed:', e);
		return false;
	}
}

