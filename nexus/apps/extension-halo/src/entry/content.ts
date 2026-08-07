// goal: HALO top-frame document-start Content Script Host
// inv: Keep this entry limited to controls that must exist before document_idle.
// NOTE: UserScripts injection is handled by chrome.userScripts API (registry.ts).

import { init as initSmoothScroll } from '../content/smooth-scroll';

const LOG_TAG = '[HALO]';
const t0 = performance.now();

console.log(LOG_TAG, 'Top-frame content host loaded at', t0.toFixed(2), 'ms');

// Track active top-frame content tools.
const activeTools = new Set<string>();
const CROSS_FRAME_TOOL_MESSAGES = new Set([
	'HALO_RULER_START',
	'HALO_RULER_CANCEL',
	'HALO_DOM_SELECTOR_START',
	'HALO_DOM_SELECTOR_STOP',
	'HALO_ANNOTATE_START',
	'HALO_ANNOTATE_STOP',
]);

// ===== MESSAGE HANDLER =====
// Generic/status ownership stays top-frame only. Explicit cross-frame tool
// commands are intentionally left unanswered here so the minimal frame-tools
// host can execute them in every matching frame without response competition.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message !== 'object') {
		sendResponse({ success: false, error: 'Invalid message format' });
		return false;
	}
	if (CROSS_FRAME_TOOL_MESSAGES.has(message.type)) return false;

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
				sendResponse({ success: false, error: 'Missing toolId' });
			}
			break;
		}

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

		default:
			sendResponse({ success: false, error: 'Unknown message type' });
	}
	return false;
});

// Smooth Scroll owns wheel input and therefore remains available from
// document_start. Hover Zoom is a separate top-frame document_idle entry.
void initSmoothScroll().catch((error: unknown) => {
	console.error(LOG_TAG, 'Smooth Scroll init failed:', error);
});

console.log(LOG_TAG, 'Top-frame document-start host ready in', (performance.now() - t0).toFixed(2), 'ms');
