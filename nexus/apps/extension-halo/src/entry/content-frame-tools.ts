// goal: minimal all-frame command bootstrap for iframe-spanning HALO tools
// inv: Heavy tool implementations load only after an explicit activation command.

import {
	FRAME_TOOL_ANNOTATE_START,
	FRAME_TOOL_ANNOTATE_STOP,
	FRAME_TOOL_DOM_SELECTOR_START,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_RULER_START,
	type FrameToolMessageType,
} from '../content/frame-tool-messages';

const LOG_TAG = '[HALO:FrameTools]';
const RUNTIME_PATH = 'tools/_frame-tools/runtime.js';

const FRAME_TOOL_TYPES = new Set<FrameToolMessageType>([
	FRAME_TOOL_RULER_START,
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_DOM_SELECTOR_START,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_ANNOTATE_START,
	FRAME_TOOL_ANNOTATE_STOP,
]);

const DEACTIVATION_TYPES = new Set<FrameToolMessageType>([
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_ANNOTATE_STOP,
]);

interface FrameToolRuntime {
	handleFrameToolMessage(message: { type: FrameToolMessageType }): boolean;
}

let runtimePromise: Promise<FrameToolRuntime> | null = null;

function isFrameToolMessageType(value: string): value is FrameToolMessageType {
	return FRAME_TOOL_TYPES.has(value as FrameToolMessageType);
}

function loadRuntime(): Promise<FrameToolRuntime> {
	if (runtimePromise) return runtimePromise;
	const runtimeUrl = chrome.runtime.getURL(RUNTIME_PATH);
	const pending = import(runtimeUrl)
		.then((module: unknown) => {
			if (
				typeof module !== 'object' ||
				module === null ||
				typeof (module as Partial<FrameToolRuntime>).handleFrameToolMessage !== 'function'
			) {
				throw new Error('HALO frame-tool runtime has an invalid module contract');
			}
			return module as FrameToolRuntime;
		})
		.catch((error: unknown) => {
			if (runtimePromise === pending) runtimePromise = null;
			throw error;
		});
	runtimePromise = pending;
	return pending;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (
		!message ||
		typeof message !== 'object' ||
		typeof message.type !== 'string' ||
		!isFrameToolMessageType(message.type)
	) {
		return false;
	}

	const type = message.type;
	// A stop before the first activation owns no runtime state. Do not turn a
	// no-op cleanup into a network/module load in every frame.
	if (!runtimePromise && DEACTIVATION_TYPES.has(type)) {
		sendResponse({ success: true, loaded: false });
		return false;
	}

	void loadRuntime()
		.then((runtime) => {
			if (!runtime.handleFrameToolMessage({ type })) {
				throw new Error(`HALO frame-tool runtime rejected ${type}`);
			}
			sendResponse({ success: true, loaded: true });
		})
		.catch((error: unknown) => {
			console.warn(LOG_TAG, 'Lazy runtime command failed', error);
			sendResponse({ success: false, loaded: false });
		});

	// Keep the message channel alive until the lazy module has loaded and the
	// command has executed. tabs.sendMessage broadcasts to every frame host;
	// each frame executes independently even though only one response is used.
	return true;
});
