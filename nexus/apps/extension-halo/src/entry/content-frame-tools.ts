// goal: minimal all-frame host for tools whose semantics intentionally span iframes
// inv: Keep this entry dormant until an explicit tool command; no timers/observers at module load.

import { Actions } from '@nexus/contracts';
import * as Ruler from '../content/ruler';
import * as DomSelector from '../content/dom-selector';
import * as PageAnnotate from '../content/page-annotate';

const LOG_TAG = '[HALO:FrameTools]';

function isExpectedRuntimeDisconnect(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Extension context invalidated') ||
		message.includes('Receiving end does not exist') ||
		message.includes('message port closed');
}

function sendRuntimeMessageBestEffort(message: unknown): void {
	try {
		void chrome.runtime.sendMessage(message).catch((error: unknown) => {
			if (!isExpectedRuntimeDisconnect(error)) {
				console.warn(LOG_TAG, 'DOM selection notification failed', error);
			}
		});
	} catch (error: unknown) {
		if (!isExpectedRuntimeDisconnect(error)) {
			console.warn(LOG_TAG, 'DOM selection notification failed', error);
		}
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message !== 'object') return false;

	switch (message.type) {
		case Actions.HALO_RULER_START:
			Ruler.start();
			sendResponse({ success: true });
			return false;

		case Actions.HALO_RULER_CANCEL:
			Ruler.cancel();
			sendResponse({ success: true });
			return false;

		case 'HALO_DOM_SELECTOR_START':
			DomSelector.start((data) => {
				sendRuntimeMessageBestEffort({ type: 'HALO_DOM_SELECTED', payload: data });
			});
			sendResponse({ success: true });
			return false;

		case 'HALO_DOM_SELECTOR_STOP':
			DomSelector.stop();
			sendResponse({ success: true });
			return false;

		case 'HALO_ANNOTATE_START':
			PageAnnotate.start();
			sendResponse({ success: true });
			return false;

		case 'HALO_ANNOTATE_STOP':
			PageAnnotate.stop();
			sendResponse({ success: true });
			return false;

		default:
			// Do not compete with the top-frame host for generic/status responses.
			return false;
	}
});
