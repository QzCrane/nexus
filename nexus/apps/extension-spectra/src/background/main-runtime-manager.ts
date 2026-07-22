// goal: sole owner of MAIN world content-script injection for fullscreen and playback-rate bridges

import { swLog } from '../shared/logger';

let initialized = false;

export function initializeMainRuntimeManager(): void {
	if (initialized) return;
	initialized = true;
	swLog.debug('[MAIN] one-shot allowlisted site API fallback initialized');
}

export const MAIN_WORLD_CONTENT_FILES = [
	'content-fullscreen-bridge.js',
	'content-playback-rate-bridge.js',
] as const;

export async function injectMainBridges(tabId: number): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-fullscreen-bridge.js'],
		world: 'MAIN',
	});
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-playback-rate-bridge.js'],
		world: 'MAIN',
	});
}

export async function injectMainBootstrap(tabId: number): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-bootstrap.js'],
		world: 'ISOLATED',
	});
}