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
		const selection = document.getSelection()?.toString();
		if (selection && selection.trim()) {
			chrome.runtime.sendMessage({
				type: 'HALO_CLIPBOARD_ADD',
				text: selection,
				sourceUrl: window.location.href,
				sourceTitle: document.title,
			});
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
	const settings = result['halo_tool_clipboard_settings'] || { enabled: true };
	updateClipboardState(settings.enabled);
});

// Dynamic toggle
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && changes['halo_tool_clipboard_settings']) {
		const newState = changes['halo_tool_clipboard_settings'].newValue || { enabled: true };
		updateClipboardState(newState.enabled);
	}
});

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'HALO_GET_STATUS':
			sendResponse({
				hostname: window.location.hostname,
				activeTools: Array.from(activeTools),
			});
			break;

		case 'HALO_TOOL_ACTIVATE':
			const toolId = message.payload?.toolId;
			if (toolId) {
				console.log(LOG_TAG, 'Tool activation requested:', toolId);
				activeTools.add(toolId);
				sendResponse({ success: true, toolId });
			} else {
				sendResponse({ success: false, error: 'Missing toolId' });
			}
			break;

		case 'HALO_TOOL_DEACTIVATE':
			const deactivateId = message.payload?.toolId;
			if (deactivateId) {
				activeTools.delete(deactivateId);
				sendResponse({ success: true });
			}
			break;

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
				chrome.runtime.sendMessage({ type: 'HALO_DOM_SELECTED', payload: data });
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

		case 'HALO_SCROLL_TO_HEADING':
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

console.log(LOG_TAG, 'Content script ready in', (performance.now() - t0).toFixed(2), 'ms');
