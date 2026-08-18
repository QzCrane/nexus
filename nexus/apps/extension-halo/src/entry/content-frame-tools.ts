// goal: minimal all-frame command bootstrap for release-admitted iframe-spanning HALO tools
// inv: Catalog-only frame tools cannot trigger or load implementation code.

import {
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_RULER_START,
} from '../content/frame-tool-messages';

const LOG_TAG = '[HALO:FrameTools]';
const RUNTIME_PATH = 'tools/_frame-tools/runtime.js';

type AdmittedFrameToolMessageType =
	| typeof FRAME_TOOL_RULER_START
	| typeof FRAME_TOOL_RULER_CANCEL;

const FRAME_TOOL_TYPES = new Set<AdmittedFrameToolMessageType>([
	FRAME_TOOL_RULER_START,
	FRAME_TOOL_RULER_CANCEL,
]);

const DEACTIVATION_TYPES = new Set<AdmittedFrameToolMessageType>([
	FRAME_TOOL_RULER_CANCEL,
]);

interface FrameToolRuntime {
	handleFrameToolMessage(message: { type: AdmittedFrameToolMessageType }): boolean;
}

let runtimePromise: Promise<FrameToolRuntime> | null = null;

function isAdmittedFrameToolMessageType(value: string): value is AdmittedFrameToolMessageType {
	return FRAME_TOOL_TYPES.has(value as AdmittedFrameToolMessageType);
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
		!isAdmittedFrameToolMessageType(message.type)
	) {
		return false;
	}

	const type = message.type;
	// A stop before the first activation owns no runtime state. Do not turn a
	// no-op cleanup into a module load in every frame.
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

	// tabs.sendMessage broadcasts to every frame host; each frame executes the
	// one admitted Ruler capability independently even though one response wins.
	return true;
});
