// goal: HALO top-frame Content Script Host (modular)
// inv: Cross-frame work belongs in purpose-built minimal hosts such as content-clipboard.ts.
// NOTE: UserScripts injection is handled by chrome.userScripts API (registry.ts).

import * as Ruler from '../content/ruler';
import { init as initSmoothScroll } from '../content/smooth-scroll';
import * as DomSelector from '../content/dom-selector';
import * as PageAnnotate from '../content/page-annotate';

const LOG_TAG = '[HALO]';
const t0 = performance.now();

function isExpectedRuntimeDisconnect(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Extension context invalidated') ||
		message.includes('Receiving end does not exist') ||
		message.includes('message port closed');
}

function sendRuntimeMessageBestEffort(
	message: unknown,
	phase: string,
): void {
	try {
		void chrome.runtime.sendMessage(message).catch((error: unknown) => {
			if (!isExpectedRuntimeDisconnect(error)) {
				console.warn(LOG_TAG, `${phase} notification failed`, error);
			}
		});
	} catch (error: unknown) {
		if (!isExpectedRuntimeDisconnect(error)) {
			console.warn(LOG_TAG, `${phase} notification failed`, error);
		}
	}
}

console.log(LOG_TAG, 'Top-frame content host loaded at', t0.toFixed(2), 'ms');

// Track active top-frame content tools.
const activeTools = new Set<string>();

// ===== MESSAGE HANDLER =====
// A single top-frame owner prevents tabs.sendMessage broadcasts from creating
// competing generic responses in every iframe. The only all-frame host is the
// clipboard capture surface and it intentionally registers no runtime router.
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
				sendRuntimeMessageBestEffort(
					{ type: 'HALO_DOM_SELECTED', payload: data },
					'DOM selection',
				);
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
