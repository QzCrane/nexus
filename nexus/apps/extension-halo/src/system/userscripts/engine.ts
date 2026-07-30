// goal: UserScripts engine - runs in background service worker
// eff: Handles run count tracking and manual injection from panel
// NOTE: Primary injection is now handled by chrome.userScripts API (registry.ts)

import type { UserScript } from './types';
import { incrementRunCount } from './core';
import { syncRegisteredScripts } from './registry';

const LOG_TAG = '[HALO:UserScripts]';

type UserScriptsMessage =
	| { type: 'HALO_USERSCRIPT_RAN'; scriptId: string }
	| { type: 'HALO_USERSCRIPTS_SYNC' };

type UserScriptsResponse =
	| { success: true }
	| { success: false; error: string };

function isUserScriptsMessage(message: unknown): message is UserScriptsMessage {
	if (typeof message !== 'object' || message === null) return false;
	if (!('type' in message)) return false;
	if (message.type === 'HALO_USERSCRIPTS_SYNC') return true;
	return message.type === 'HALO_USERSCRIPT_RAN'
		&& 'scriptId' in message
		&& typeof message.scriptId === 'string'
		&& message.scriptId.length > 0;
}

// Initialize engine - register message listeners
// rule: return a cleanup function and guard against double-registration.
// Previously the runtime.onMessage listener was attached on every call with
// no way to remove it, so repeated init stacked N listeners that each
// responded to the same message and each called sendResponse.
let engineInitialized = false;
export function initUserScriptsEngine(): () => void {
	if (engineInitialized) return () => {};
	engineInitialized = true;

	console.log(LOG_TAG, 'Engine initialized');

	// Listen for messages
	const listener = (
		message: unknown,
		_sender: chrome.runtime.MessageSender,
		sendResponse: (response: UserScriptsResponse) => void,
	) => {
		if (!isUserScriptsMessage(message)) return false;
		// Run count updates from content script
		if (message.type === 'HALO_USERSCRIPT_RAN') {
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
	};

	chrome.runtime.onMessage.addListener(listener);

	return () => {
		chrome.runtime.onMessage.removeListener(listener);
		engineInitialized = false;
	};
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
			// biome-ignore lint/style/useTemplate: concatenation required — see rule above (user code/safeName may contain backticks/`${}`)
			'    ' + code,
			// biome-ignore lint/style/useTemplate: concatenation required — see rule above (user code/safeName may contain backticks/`${}`)
			'    console.log("[HALO Script] ' + safeName + ' executed");',
			'} catch (e) {',
			// biome-ignore lint/style/useTemplate: concatenation required — see rule above (user code/safeName may contain backticks/`${}`)
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
