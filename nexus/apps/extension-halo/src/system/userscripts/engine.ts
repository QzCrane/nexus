// goal: UserScripts engine - runs in background service worker
// eff: Handles run count tracking and manual injection from panel
// NOTE: Primary injection is now handled by chrome.userScripts API (registry.ts)

import { readOptionalPackagedModuleEnabled } from '../../kernel/core/module-installation-runtime';
import type { UserScript } from './types';
import { incrementRunCount } from './core';
import { ensureUserScriptsRuntimeReady } from './registry';

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
			void ensureUserScriptsRuntimeReady()
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

export async function injectScriptToCurrentTab(script: UserScript): Promise<boolean> {
	try {
		await requireInstalledModule();
		const hasAccess = await chrome.permissions.contains({
			permissions: ['userScripts'],
			origins: ['*://*/*'],
		});
		if (!hasAccess) throw new Error('User Scripts permission and host access are required');
		await ensureUserScriptsRuntimeReady();
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return false;
		if (script.type === 'css') {
			await chrome.scripting.insertCSS({
				target: { tabId: tab.id },
				css: script.code,
			});
		} else {
			const results = await chrome.userScripts.execute({
				target: { tabId: tab.id },
				js: [{ code: script.code }],
				world: script.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT',
				injectImmediately: true,
			});
			const failure = results.find((result) => result.error);
			if (failure?.error) throw new Error(failure.error);
		}
		await incrementRunCount(script.id);
		return true;
	} catch (e) {
		console.warn(LOG_TAG, 'Manual injection failed:', e);
		return false;
	}
}
