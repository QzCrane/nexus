// goal: HALO top-frame Content Script Host
// inv: Cross-frame work belongs in purpose-built minimal hosts.
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
	// rule: chrome.runtime permits primitive messages (e.g. chrome.runtime.sendMessage("ping"));
	// without this guard, message.type on a string/number/null throws TypeError inside the
	// listener, Chrome swallows the throw but sendResponse is never called, hanging the caller.
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
				// rule: respond on every early-return path — otherwise the caller's
				// promise hangs forever waiting for a response that never arrives.
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

// ===== INITIALIZE TOP-FRAME MODULES =====
void initSmoothScroll().catch((error: unknown) => {
	console.error(LOG_TAG, 'Smooth Scroll init failed:', error);
});

// HoverZoom remains source-lazy. The classic content-script build still owns a
// single physical bundle; a later injection boundary can make this import
// physically lazy without moving a user-facing capability into every frame.
import('../content/hover-zoom').then((module) => module.init()).catch((error: unknown) => {
	console.warn(LOG_TAG, 'HoverZoom init failed:', error);
});

console.log(LOG_TAG, 'Top-frame content host ready in', (performance.now() - t0).toFixed(2), 'ms');
