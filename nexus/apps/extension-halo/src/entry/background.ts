// goal: HALO Background Service Worker
// Handles extension lifecycle, storage init, SidePanel control, and context menus

import { STORAGE_PREFIX } from '../kernel';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../kernel';
import { initUserScriptsEngine } from '../system/userscripts/engine';
import { initUserScriptsRegistry } from '../system/userscripts/registry';
import { syncSaaTTools, initSaaTService } from '../kernel/services/saat-service';
import { TOOL_REGISTRY } from '../kernel/registry/tool-registry';
import { isPrivateHost } from '../kernel/utils/ssrf-guard';

const LOG_TAG = '[HALO]';

initUserScriptsEngine();
initUserScriptsRegistry();
initSaaTService();

const MENU_OPEN_HALO = 'halo-open';
const MENU_QR_SELECTION = 'halo-qr-selection';
const MENU_COLOR_PICK = 'halo-color-pick';
const MENU_PDF_LINK = 'halo-pdf-link';

async function sendPrefillMessage(message: unknown, maxRetries = 5): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			await chrome.runtime.sendMessage(message);
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100 * (i + 1)));
		}
	}
}

chrome.runtime.onInstalled.addListener(async (details) => {
	console.log(LOG_TAG, 'Extension installed/updated:', details.reason);

	await syncSaaTTools(TOOL_REGISTRY);

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

import { saveToClipboardHistory } from '../tools/clipboard/core';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'HALO_CLIPBOARD_ADD') {
		const { text, sourceUrl, sourceTitle } = message;
		saveToClipboardHistory(
			text,
			sourceUrl || sender.url,
			sourceTitle || sender.tab?.title
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
			credentials: 'omit'
		})
			.then(async res => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				if (responseType === 'arraybuffer') {
					const buf = await res.arrayBuffer();
					const bytes = new Uint8Array(buf);
					const CHUNK = 0x8000;
					const chunks: string[] = [];
					for (let i = 0; i < bytes.length; i += CHUNK) {
						chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
					}
					return btoa(chunks.join(''));
				}
				return res.text();
			})
			.then(data => sendResponse({ success: true, data }))
			.catch(err => sendResponse({ success: false, error: err.message }));

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
			css: css,
		}).then(() => {
			console.log(LOG_TAG, 'Injected dynamic CSS for tab', sender.tab?.id);
			sendResponse({ success: true });
		}).catch(e => {
			console.warn(LOG_TAG, 'Failed to inject CSS:', e);
			sendResponse({ success: false, error: e.message });
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
		for (const [k, { newValue }] of Object.entries(changes)) {
			if (k.startsWith(STORAGE_PREFIX.CORE) || k === SETTINGS_STORAGE_KEY) {
				console.log(LOG_TAG, `Storage: ${k}`, newValue);
			}
		}
	});
}
