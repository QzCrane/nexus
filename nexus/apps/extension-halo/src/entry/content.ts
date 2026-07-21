// goal: HALO Content Script Host (modular)
// Entry point that imports and initializes content modules
// NOTE: UserScripts injection is now handled by chrome.userScripts API (registry.ts)

import * as Ruler from '../content/ruler';
import * as SmoothScroll from '../content/smooth-scroll';
import * as DomSelector from '../content/dom-selector';
import * as PageAnnotate from '../content/page-annotate';
// HoverZoom is loaded dynamically only in top frame to avoid loading in iframes

const LOG_TAG = '[HALO]';
const t0 = performance.now();

console.log(LOG_TAG, 'Content script loaded at', t0.toFixed(2), 'ms');

// Track active content tools
const activeTools = new Set<string>();

// ===== CLIPBOARD TRACKING =====
// eff: True 0-CPU style - listener is only attached when enabled

const onCopy = () => {
	setTimeout(() => {
		// rule: skip password fields — copying the masked selection from a
		// password input would leak the actual cleartext password into history.
		const active = document.activeElement;
		if (active instanceof HTMLInputElement && active.type === 'password') return;
		const selection = document.getSelection()?.toString();
		if (selection?.trim()) {
			// rule: wrap sendMessage — when the SW is restarting or the extension is
			// being unloaded, this throws "Extension context invalidated" and would
			// surface as an unhandled rejection in the page console on every copy.
			try {
				void chrome.runtime.sendMessage({
					type: 'HALO_CLIPBOARD_ADD',
					text: selection,
					sourceUrl: window.location.href,
					sourceTitle: document.title,
				});
			} catch {
				// best-effort notification; ignore SW-restart races
			}
		}
	}, 50);
};

let isClipboardListenerAttached = false;

function updateClipboardState(enabled: boolean) {
	if (enabled && !isClipboardListenerAttached) {
		document.addEventListener('copy', onCopy);
		isClipboardListenerAttached = true;
		console.log(LOG_TAG, 'Clipboard tracking: ON');
	} else if (!enabled && isClipboardListenerAttached) {
		document.removeEventListener('copy', onCopy);
		isClipboardListenerAttached = false;
		console.log(LOG_TAG, 'Clipboard tracking: OFF');
	}
}

// Initial check
chrome.storage.local.get(['halo_tool_clipboard_settings'], (result) => {
	const settings = result.halo_tool_clipboard_settings || { enabled: true };
	updateClipboardState(settings.enabled);
});

// Dynamic toggle
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && changes.halo_tool_clipboard_settings) {
		const newState = changes.halo_tool_clipboard_settings.newValue || { enabled: true };
		updateClipboardState(newState.enabled);
	}
});

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	// rule: chrome.runtime permits primitive messages (e.g. chrome.runtime.sendMessage("ping"));
	// without this guard, message.type on a string/number/null throws TypeError inside the
	// listener, Chrome swallows the throw but sendResponse is never called, hanging the caller.
	if (!message || typeof message !== 'object') {
		sendResponse({ success: false, error: 'Invalid message format' });
		return false;
	}
	switch (message.type) {
		case 'HALO_GET_STATUS':
			sendResponse({
				hostname: window.location.hostname,
				activeTools: Array.from(activeTools),
			});
			break;

		case 'HALO_TOOL_ACTIVATE': {
			const toolId = message.payload?.toolId;
			if (toolId) {
				console.log(LOG_TAG, 'Tool activation requested:', toolId);
				activeTools.add(toolId);
				sendResponse({ success: true, toolId });
			} else {
				sendResponse({ success: false, error: 'Missing toolId' });
			}
			break;
		}

		case 'HALO_TOOL_DEACTIVATE': {
			const deactivateId = message.payload?.toolId;
			if (deactivateId) {
				activeTools.delete(deactivateId);
				sendResponse({ success: true });
			} else {
				// rule: respond on every early-return path — otherwise the caller's
				// promise hangs forever waiting for a response that never arrives.
				sendResponse({ success: false, error: 'Missing toolId' });
			}
			break;
		}

		case 'HALO_RULER_START':
			Ruler.start();
			sendResponse({ success: true });
			break;

		case 'HALO_RULER_CANCEL':
			Ruler.cancel();
			sendResponse({ success: true });
			break;

		case 'HALO_DOM_SELECTOR_START':
			DomSelector.start((data) => {
				// rule: best-effort notification — wrap to avoid unhandled rejection
				// when the SW is restarting or the extension is being unloaded.
				try {
					void chrome.runtime.sendMessage({ type: 'HALO_DOM_SELECTED', payload: data });
				} catch {
					// ignore SW-restart races
				}
			});
			sendResponse({ success: true });
			break;

		case 'HALO_DOM_SELECTOR_STOP':
			DomSelector.stop();
			sendResponse({ success: true });
			break;

		case 'HALO_ANNOTATE_START':
			PageAnnotate.start();
			sendResponse({ success: true });
			break;

		case 'HALO_ANNOTATE_STOP':
			PageAnnotate.stop();
			sendResponse({ success: true });
			break;

		case 'HALO_SCROLL_TO_HEADING': {
			const headingIndex = message.index;
			if (typeof headingIndex === 'number') {
				const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
				const target = headings[headingIndex];
				if (target) {
					target.scrollIntoView({ behavior: 'smooth', block: 'center' });
					const el = target as HTMLElement;
					const original = el.style.background;
					el.style.background = 'rgba(124,58,237,0.3)';
					setTimeout(() => { el.style.background = original; }, 1500);
				}
				sendResponse({ success: true });
			} else {
				sendResponse({ success: false, error: 'Missing index' });
			}
			break;
		}

		case 'HALO_SMOOTH_SCROLL_UPDATE':
			if (message.settings) {
				SmoothScroll.updateSettings(message.settings);
			}
			sendResponse({ success: true });
			break;

		default:
			sendResponse({ success: false, error: 'Unknown message type' });
	}
	return false;
});

// ===== INITIALIZE MODULES =====
SmoothScroll.init();

// HoverZoom: Dynamic import only in top frame (avoid loading ~50KB in each iframe)
if (window === window.top) {
	import('../content/hover-zoom').then(m => m.init()).catch(e => {
		console.warn(LOG_TAG, 'HoverZoom init failed:', e);
	});
}

// LLM Enhancer Loader
// rule: precise hostname matching — the previous substring regex would match
// notchatgpt.com or openai.example.org. Match either exact hosts or their
// documented subdomain suffixes only.
const LLM_HOSTS = new Set([
	'chatgpt.com',
	'chat.openai.com',
	'openai.com',
	'deepseek.com',
	'gemini.google.com',
	'aistudio.google.com',
	'claude.ai',
]);
const llmHostname = window.location.hostname;
const isLlmSite =
	LLM_HOSTS.has(llmHostname) ||
	llmHostname.endsWith('.chatgpt.com') ||
	llmHostname.endsWith('.openai.com');
if (isLlmSite) {
	const toolUrl = chrome.runtime.getURL('tools/llm-enhancer/script.js');
	import(toolUrl).then(() => {
		console.log(LOG_TAG, 'LLM Enhancer loaded');
	}).catch(e => {
		console.error(LOG_TAG, 'LLM Enhancer load failed:', e);
	});
}

console.log(LOG_TAG, 'Content script ready in', (performance.now() - t0).toFixed(2), 'ms');
