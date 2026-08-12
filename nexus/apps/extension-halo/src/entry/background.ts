// goal: HALO Background Service Worker
// Handles extension lifecycle, storage init, SidePanel control, and context menus

import { STORAGE_PREFIX } from '../kernel/core/types';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../kernel/core/settings';
import { initUserScriptsEngine } from '../system/userscripts/engine';
import { initUserScriptsRegistry, syncRegisteredScripts } from '../system/userscripts/registry';
import {
	initSaaTService,
	syncSaaTTools,
	type SaaTPluginDescriptor,
} from '../kernel/services/saat-service';
import { isPrivateHost } from '../kernel/utils/ssrf-guard';
import { saveToClipboardHistory } from '../tools/clipboard/core';

const LOG_TAG = '[HALO]';
const SCRIPT_RUNTIME_ASSET = 'script-plugin-runtime.json';

initUserScriptsEngine();
initUserScriptsRegistry();
initSaaTService();

const MENU_OPEN_HALO = 'halo-open';
const MENU_QR_SELECTION = 'halo-qr-selection';
const MENU_COLOR_PICK = 'halo-color-pick';
const MENU_PDF_LINK = 'halo-pdf-link';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSaaTPluginDescriptor(value: unknown): value is SaaTPluginDescriptor {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.builtIn !== 'boolean') return false;
	if (value.pluginType !== 'tool' && value.pluginType !== 'script' && value.pluginType !== 'system') return false;
	const script = value.script;
	if (!isRecord(script)) return false;
	if (script.type !== 'javascript' && script.type !== 'typescript' && script.type !== 'css') return false;
	if (script.runAt !== 'document_start' && script.runAt !== 'document_end' && script.runAt !== 'document_idle') return false;
	if (!isStringArray(script.matches)) return false;
	if (script.excludeMatches !== undefined && !isStringArray(script.excludeMatches)) return false;
	if (
		script.world !== undefined
		&& script.world !== 'ISOLATED'
		&& script.world !== 'MAIN'
		&& script.world !== 'USER_SCRIPT'
	) return false;
	return true;
}

async function loadScriptRuntimeDescriptors(): Promise<SaaTPluginDescriptor[]> {
	const response = await fetch(chrome.runtime.getURL(SCRIPT_RUNTIME_ASSET));
	if (!response.ok) throw new Error(`script runtime asset returned HTTP ${response.status}`);
	const value: unknown = await response.json();
	if (!Array.isArray(value) || !value.every(isSaaTPluginDescriptor)) {
		throw new Error('script runtime asset failed descriptor validation');
	}
	return value;
}

async function sendPrefillMessage(message: unknown, maxRetries = 5): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			await chrome.runtime.sendMessage(message);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
		}
	}
}

chrome.runtime.onInstalled.addListener(async (details) => {
	console.log(LOG_TAG, 'Extension installed/updated:', details.reason);

	// The full UI TOOL_REGISTRY is intentionally absent from the service-worker
	// dependency graph. Script metadata is generated as local data and read only
	// on install/update, the only lifecycle that needs SaaT reconciliation.
	try {
		await syncSaaTTools(await loadScriptRuntimeDescriptors());
	} catch (error: unknown) {
		console.warn(LOG_TAG, 'SaaT install synchronization skipped:', error);
	}

	// userScripts registrations are cleared by extension updates while dynamic
	// scripting registrations persist across ordinary worker/browser sessions.
	// Reconcile once on install/update; the registry's storage listener owns
	// subsequent changes without rebuilding registrations on every worker wake.
	try {
		await syncRegisteredScripts();
	} catch (error: unknown) {
		console.warn(LOG_TAG, 'UserScripts install synchronization failed:', error);
	}

	const storage = await chrome.storage.sync.get([
		`${STORAGE_PREFIX.CORE}active_tool`,
		SETTINGS_STORAGE_KEY,
	]);

	const defaults: Record<string, unknown> = {};

	if (storage[`${STORAGE_PREFIX.CORE}active_tool`] === undefined) {
		defaults[`${STORAGE_PREFIX.CORE}active_tool`] = null;
	}

	if (!storage[SETTINGS_STORAGE_KEY]) {
		defaults[SETTINGS_STORAGE_KEY] = DEFAULT_SETTINGS;
	}

	if (Object.keys(defaults).length > 0) {
		await chrome.storage.sync.set(defaults);
		console.log(LOG_TAG, 'Default settings initialized');
	}

	try {
		await chrome.contextMenus.removeAll();
		chrome.contextMenus.create({
			id: MENU_OPEN_HALO,
			title: '🌟 Open HALO Toolbox',
			contexts: ['page', 'selection', 'image', 'link'],
		});

		chrome.contextMenus.create({
			id: MENU_QR_SELECTION,
			title: '🔲 Generate QR Code',
			contexts: ['selection', 'link'],
		});

		chrome.contextMenus.create({
			id: MENU_COLOR_PICK,
			title: '🎨 Pick Color from Page',
			contexts: ['page'],
		});

		chrome.contextMenus.create({
			id: MENU_PDF_LINK,
			title: '📕 Open PDF in HALO',
			contexts: ['link'],
			targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*'],
		});
	} catch (err) {
		console.warn(LOG_TAG, 'Context menu setup failed', err);
	}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) return;

	switch (info.menuItemId) {
		case MENU_OPEN_HALO:
			await chrome.sidePanel.open({ tabId: tab.id });
			break;

		case MENU_QR_SELECTION: {
			await chrome.sidePanel.open({ tabId: tab.id });
			const text = info.selectionText || info.linkUrl || '';
			if (text) {
				void sendPrefillMessage({
					type: 'HALO_PREFILL_QR',
					text,
				});
			}
			break;
		}

		case MENU_COLOR_PICK:
			await chrome.sidePanel.open({ tabId: tab.id });
			void sendPrefillMessage({
				type: 'HALO_ACTIVATE_TOOL',
				toolId: 'color-picker',
			});
			break;

		case MENU_PDF_LINK: {
			await chrome.sidePanel.open({ tabId: tab.id });
			const pdfUrl = info.linkUrl;
			if (pdfUrl) {
				void sendPrefillMessage({
					type: 'HALO_ACTIVATE_TOOL',
					toolId: 'pdf',
					pdfUrl,
				});
			}
			break;
		}
	}
});

chrome.action.onClicked.addListener(async (tab) => {
	if (tab.id) {
		try {
			await chrome.sidePanel.open({ tabId: tab.id });
			console.log(LOG_TAG, 'SidePanel opened for tab:', tab.id);
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to open SidePanel:', e);
		}
	}
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'HALO_CLIPBOARD_ADD') {
		const { text, sourceUrl, sourceTitle } = message;
		saveToClipboardHistory(
			text,
			sourceUrl || sender.url,
			sourceTitle || sender.tab?.title,
		).then(
			() => { sendResponse({ success: true }); },
			(error) => { sendResponse({ success: false, error: String(error) }); },
		);
		return true;
	}

	if (message.type === 'HALO_HZ_PROXY_AJAX') {
		const { url, method = 'GET', headers = {}, body, responseType = 'text' } = message;
		if (!url || typeof url !== 'string') {
			sendResponse({ success: false, error: 'missing url' });
			return true;
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			sendResponse({ success: false, error: 'invalid URL' });
			return true;
		}
		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			sendResponse({ success: false, error: 'only http(s) supported' });
			return true;
		}
		const host = parsedUrl.hostname.toLowerCase();
		if (isPrivateHost(host)) {
			sendResponse({ success: false, error: 'private/internal hosts blocked' });
			return true;
		}

		console.log(LOG_TAG, 'HoverZoom proxy request:', url.slice(0, 80), 'type:', responseType);

		fetch(url, {
			method,
			headers: { ...headers },
			body: method === 'POST' ? body : undefined,
			credentials: 'omit',
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				if (responseType === 'arraybuffer') {
					const buffer = await response.arrayBuffer();
					const bytes = new Uint8Array(buffer);
					const chunkSize = 0x8000;
					const chunks: string[] = [];
					for (let index = 0; index < bytes.length; index += chunkSize) {
						chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
					}
					return btoa(chunks.join(''));
				}
				return response.text();
			})
			.then((data) => sendResponse({ success: true, data }))
			.catch((error) => sendResponse({ success: false, error: error.message }));

		return true;
	}

	if (message.type === 'HALO_INJECT_CSS') {
		const { css } = message;
		if (!sender.tab?.id || !css) {
			sendResponse({ success: false, error: 'missing_tab_or_css' });
			return false;
		}
		chrome.scripting.insertCSS({
			target: { tabId: sender.tab.id },
			css,
		}).then(() => {
			console.log(LOG_TAG, 'Injected dynamic CSS for tab', sender.tab?.id);
			sendResponse({ success: true });
		}).catch((error) => {
			console.warn(LOG_TAG, 'Failed to inject CSS:', error);
			sendResponse({ success: false, error: error.message });
		});
		return true;
	}

	return false;
});

// Debug-only sync-storage tracing must not register an event listener in the
// production service worker. `process.env.NODE_ENV` is compile-time defined by
// build.ts, so minification removes this whole block and its wake-up surface.
if (process.env.NODE_ENV !== 'production') {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'sync') return;
		for (const [key, { newValue }] of Object.entries(changes)) {
			if (key.startsWith(STORAGE_PREFIX.CORE) || key === SETTINGS_STORAGE_KEY) {
				console.log(LOG_TAG, `Storage: ${key}`, newValue);
			}
		}
	});
}
