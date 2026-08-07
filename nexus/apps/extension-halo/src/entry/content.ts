// goal: HALO top-frame document-start control router
// inv: Frame-local physical input belongs to dedicated all-frame hosts.
// NOTE: UserScripts injection is handled by chrome.userScripts API (registry.ts).

export {};

const LOG_TAG = '[HALO]';
const t0 = performance.now();

console.log(LOG_TAG, 'Top-frame content host loaded at', t0.toFixed(2), 'ms');

const activeTools = new Set<string>();
const CROSS_FRAME_TOOL_MESSAGES = new Set([
	'HALO_RULER_START',
	'HALO_RULER_CANCEL',
	'HALO_DOM_SELECTOR_START',
	'HALO_DOM_SELECTOR_STOP',
	'HALO_ANNOTATE_START',
	'HALO_ANNOTATE_STOP',
]);

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

console.log(LOG_TAG, 'Top-frame document-start router ready in', (performance.now() - t0).toFixed(2), 'ms');
