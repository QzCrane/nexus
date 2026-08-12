// goal: UserScripts engine - runs in background service worker
// eff: Handles run count tracking and manual injection from panel
// NOTE: Primary injection is now handled by chrome.userScripts API (registry.ts)

import { readOptionalPackagedModuleEnabled } from '../../kernel/core/module-installation-runtime';
import type { UserScript } from './types';
import { incrementRunCount } from './core';
import { ensureRegisteredScriptsSynchronized } from './registry';

const LOG_TAG = '[HALO:UserScripts]';
const MODULE_ID = 'userscripts';

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

async function requireInstalledModule(): Promise<void> {
	if (!await readOptionalPackagedModuleEnabled(MODULE_ID)) {
		throw new Error('UserScripts module is not installed');
	}
}

let engineInitialized = false;
export function initUserScriptsEngine(): () => void {
	if (engineInitialized) return () => {};
	engineInitialized = true;
	console.log(LOG_TAG, 'Engine initialized');

	const listener = (
		message: unknown,
		_sender: chrome.runtime.MessageSender,
		sendResponse: (response: UserScriptsResponse) => void,
	) => {
		if (!isUserScriptsMessage(message)) return false;
		if (message.type === 'HALO_USERSCRIPT_RAN') {
			void requireInstalledModule()
				.then(() => incrementRunCount(message.scriptId))
				.then(() => sendResponse({ success: true }))
				.catch((e) => sendResponse({ success: false, error: String(e) }));
			return true;
		}
		if (message.type === 'HALO_USERSCRIPTS_SYNC') {
			void ensureRegisteredScriptsSynchronized()
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

export async function injectScriptToCurrentTab(script: UserScript): Promise<boolean> {
	try {
		await requireInstalledModule();
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
