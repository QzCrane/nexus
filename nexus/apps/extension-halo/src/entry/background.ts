// goal: HALO Background Service Worker
// Handles extension lifecycle, storage init, SidePanel control, and context menus

import { STORAGE_PREFIX } from '../kernel';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../kernel';
import { initUserScriptsEngine } from '../system/userscripts/engine';
import { initUserScriptsRegistry } from '../system/userscripts/registry';
import { syncSaaTTools, initSaaTService } from '../kernel/services/saat-service';
import { TOOL_REGISTRY } from '../kernel/tool-registry';

const LOG_TAG = '[HALO]';

// Initialize UserScripts injection engine (handles run count + manual injection)
initUserScriptsEngine();

// Initialize UserScripts registry (Chrome 120+ true document_start injection)
initUserScriptsRegistry();

// Initialize SaaT service to listen for tool pref changes
initSaaTService();

// Context menu IDs
const MENU_OPEN_HALO = 'halo-open';
const MENU_QR_SELECTION = 'halo-qr-selection';
const MENU_COLOR_PICK = 'halo-color-pick';
const MENU_PDF_LINK = 'halo-pdf-link';

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
	console.log(LOG_TAG, 'Extension installed/updated:', details.reason);

	// Sync built-in SaaT tools (like llm-enhancer) to storage
	await syncSaaTTools(TOOL_REGISTRY);

	// Set defaults if not already set
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

	// Create context menus
	chrome.contextMenus.removeAll(() => {
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
	});
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) return;

	switch (info.menuItemId) {
		case MENU_OPEN_HALO:
			await chrome.sidePanel.open({ tabId: tab.id });
			break;

		case MENU_QR_SELECTION:
			// Open sidepanel with QR tool and prefill text
			await chrome.sidePanel.open({ tabId: tab.id });
			const text = info.selectionText || info.linkUrl || '';
			if (text) {
				// Send message to sidepanel to prefill QR input
				setTimeout(() => {
					chrome.runtime.sendMessage({
						type: 'HALO_PREFILL_QR',
						text,
					});
				}, 500);
			}
			break;

		case MENU_COLOR_PICK:
			// Activate color eyedropper (future: use EyeDropper API)
			await chrome.sidePanel.open({ tabId: tab.id });
			setTimeout(() => {
				chrome.runtime.sendMessage({
					type: 'HALO_ACTIVATE_TOOL',
					toolId: 'color-picker',
				});
			}, 500);
			break;

		case MENU_PDF_LINK:
			// Open sidepanel with PDF tool and store the PDF URL
			await chrome.sidePanel.open({ tabId: tab.id });
			const pdfUrl = info.linkUrl;
			if (pdfUrl) {
				setTimeout(() => {
					chrome.runtime.sendMessage({
						type: 'HALO_ACTIVATE_TOOL',
						toolId: 'pdf',
						pdfUrl,
					});
				}, 500);
			}
			break;
	}
});

// Handle action click - open SidePanel
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

// Import history logic (Note: in worker, we might need a separate bundle or shared logic)
// Since we are using esbuild, we can import from core.
import { saveToClipboardHistory } from '../tools/clipboard/core';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'HALO_CLIPBOARD_ADD') {
		const { text, sourceUrl, sourceTitle } = message;
		saveToClipboardHistory(
			text,
			sourceUrl || sender.url,
			sourceTitle || sender.tab?.title
		).then(() => {
			sendResponse({ success: true });
		});
		return true; // async
	}

	// Hover Zoom CORS proxy - bypass CORB for cross-origin API calls
	if (message.type === 'HALO_HZ_PROXY_AJAX') {
		const { url, method = 'GET', headers = {}, body, responseType = 'text' } = message;
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
					// Chunked base64 encoding for better performance
					const buf = await res.arrayBuffer();
					const bytes = new Uint8Array(buf);
					const CHUNK = 0x8000; // 32KB chunks
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

		return true; // async
	}

	// Inject CSS dynamically (Bypass CSP)
	if (message.type === 'HALO_INJECT_CSS') {
		const { css } = message;
		if (sender.tab?.id && css) {
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
			return true; // async
		}
	}

	return false;
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'sync') return;
	for (const [k, { newValue }] of Object.entries(changes))
		if (k.startsWith(STORAGE_PREFIX.CORE) || k === SETTINGS_STORAGE_KEY)
			console.log(LOG_TAG, `Storage: ${k}`, newValue);
});
