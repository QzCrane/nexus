// goal: on-demand heavy runtime for iframe-spanning HALO tools
// inv: This module is never part of a static content-script startup closure.

import {
	FRAME_TOOL_ANNOTATE_START,
	FRAME_TOOL_ANNOTATE_STOP,
	FRAME_TOOL_DOM_SELECTOR_START,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_RULER_START,
	type FrameToolCommand,
} from '../content/frame-tool-messages';
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

const activeOperations = new Map<'ruler' | 'dom-selector' | 'annotate', string>();

function owns(tool: 'ruler' | 'dom-selector' | 'annotate', operationId: string): boolean {
	return activeOperations.get(tool) === operationId;
}

export function handleFrameToolMessage(message: FrameToolCommand): boolean {
	switch (message.type) {
		case FRAME_TOOL_RULER_START:
			Ruler.cancel();
			activeOperations.set('ruler', message.operationId);
			Ruler.start(message.operationId);
			return true;

		case FRAME_TOOL_RULER_CANCEL:
			if (!owns('ruler', message.operationId)) return true;
			Ruler.cancel();
			activeOperations.delete('ruler');
			return true;

		case FRAME_TOOL_DOM_SELECTOR_START:
			DomSelector.stop();
			activeOperations.set('dom-selector', message.operationId);
			DomSelector.start((data) => {
				if (!owns('dom-selector', message.operationId)) return;
				sendRuntimeMessageBestEffort({ type: 'HALO_DOM_SELECTED', operationId: message.operationId, payload: data });
				activeOperations.delete('dom-selector');
			});
			return true;

		case FRAME_TOOL_DOM_SELECTOR_STOP:
			if (!owns('dom-selector', message.operationId)) return true;
			DomSelector.stop();
			activeOperations.delete('dom-selector');
			return true;

		case FRAME_TOOL_ANNOTATE_START:
			PageAnnotate.stop();
			activeOperations.set('annotate', message.operationId);
			PageAnnotate.start();
			return true;

		case FRAME_TOOL_ANNOTATE_STOP:
			if (!owns('annotate', message.operationId)) return true;
			PageAnnotate.stop();
			activeOperations.delete('annotate');
			return true;
	}
}
