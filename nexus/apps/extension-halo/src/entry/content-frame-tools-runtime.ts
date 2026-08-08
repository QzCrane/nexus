// goal: on-demand heavy runtime for iframe-spanning HALO tools
// inv: This module is never part of a static content-script startup closure.

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

export function handleFrameToolMessage(message: { type: string }): boolean {
	switch (message.type) {
		case Actions.HALO_RULER_START:
			Ruler.start();
			return true;

		case Actions.HALO_RULER_CANCEL:
			Ruler.cancel();
			return true;

		case 'HALO_DOM_SELECTOR_START':
			DomSelector.start((data) => {
				sendRuntimeMessageBestEffort({ type: 'HALO_DOM_SELECTED', payload: data });
			});
			return true;

		case 'HALO_DOM_SELECTOR_STOP':
			DomSelector.stop();
			return true;

		case 'HALO_ANNOTATE_START':
			PageAnnotate.start();
			return true;

		case 'HALO_ANNOTATE_STOP':
			PageAnnotate.stop();
			return true;

		default:
			return false;
	}
}
