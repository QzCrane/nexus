// goal: UserScripts engine - runs in background service worker
// eff: Handles run count tracking and manual injection from panel
// NOTE: Primary injection is now handled by chrome.userScripts API (registry.ts)

import type { UserScript } from './types';
import { incrementRunCount } from './core';
import { syncRegisteredScripts } from './registry';

const LOG_TAG = '[HALO:UserScripts]';

// Initialize engine - register message listeners
export function initUserScriptsEngine(): void {
	console.log(LOG_TAG, 'Engine initialized');

	// Listen for messages
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		// Run count updates from content script
		if (message.type === 'HALO_USERSCRIPT_RAN' && message.scriptId) {
			incrementRunCount(message.scriptId)
				.then(() => sendResponse({ success: true }))
				.catch((e) => sendResponse({ success: false, error: String(e) }));
			return true; // Async response
		}

		// Manual sync request (after permission grant)
		if (message.type === 'HALO_USERSCRIPTS_SYNC') {
			console.log(LOG_TAG, 'Manual sync requested');
			syncRegisteredScripts()
				.then(() => sendResponse({ success: true }))
				.catch((e) => sendResponse({ success: false, error: String(e) }));
			return true;
		}

		return false;
	});
}

// Wrapper function injected into page via inline <script> tag
// rule: build the script body via string concatenation, never a template literal.
// The previous `${code}` / `${name...}` interpolations allowed user-controlled
// content containing ` or ${} to break out of the wrapping template literal and
// inject arbitrary code into the page's MAIN world. User JS legitimately contains
// template literals, so escaping is not viable — concatenation is the only safe option.
function executeUserScript(code: string, name: string): void {
	try {
		const safeName = name
			.replace(/\\/g, '\\\\')
			.replace(/'/g, "\\'")
			.replace(/"/g, '\\"')
			.replace(/\n/g, '\\n')
			.replace(/\r/g, '\\r');
		const scriptText = [
			'try {',
			'    ' + code,
			'    console.log("[HALO Script] ' + safeName + ' executed");',
			'} catch (e) {',
			'    console.error("[HALO Script] ' + safeName + ' failed:", e);',
			'}',
		].join('\n');
		const scriptEl = document.createElement('script');
		scriptEl.textContent = scriptText;
		const target = document.head || document.documentElement;
		target.insertBefore(scriptEl, target.firstChild);
		scriptEl.remove();
	} catch (e) {
		console.error(`[HALO Script] ${name} injection failed:`, e);
	}
}

// Manual injection for testing from panel (uses executeScript API)
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
