// goal: one tiny message-name authority shared by the static frame bootstrap and lazy runtime
// inv: Data-only string constants; importing this module creates no listeners, timers, observers, or browser work.

export const FRAME_TOOL_RULER_START = 'HALO_RULER_START';
export const FRAME_TOOL_RULER_CANCEL = 'HALO_RULER_CANCEL';
export const FRAME_TOOL_DOM_SELECTOR_START = 'HALO_DOM_SELECTOR_START';
export const FRAME_TOOL_DOM_SELECTOR_STOP = 'HALO_DOM_SELECTOR_STOP';
export const FRAME_TOOL_ANNOTATE_START = 'HALO_ANNOTATE_START';
export const FRAME_TOOL_ANNOTATE_STOP = 'HALO_ANNOTATE_STOP';

export type FrameToolMessageType =
	| typeof FRAME_TOOL_RULER_START
	| typeof FRAME_TOOL_RULER_CANCEL
	| typeof FRAME_TOOL_DOM_SELECTOR_START
	| typeof FRAME_TOOL_DOM_SELECTOR_STOP
	| typeof FRAME_TOOL_ANNOTATE_START
	| typeof FRAME_TOOL_ANNOTATE_STOP;

const FRAME_TOOL_MESSAGE_TYPES = new Set<string>([
	FRAME_TOOL_RULER_START,
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_DOM_SELECTOR_START,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_ANNOTATE_START,
	FRAME_TOOL_ANNOTATE_STOP,
]);

export function isFrameToolMessageType(value: unknown): value is FrameToolMessageType {
	return typeof value === 'string' && FRAME_TOOL_MESSAGE_TYPES.has(value);
}

export interface FrameToolCommand {
	type: FrameToolMessageType;
	operationId: string;
}

export interface FrameToolSession {
	tabId: number;
	operationId: string;
}

export function isFrameToolCommand(value: unknown): value is FrameToolCommand {
	return typeof value === 'object' && value !== null
		&& 'type' in value && isFrameToolMessageType(value.type)
		&& 'operationId' in value && typeof value.operationId === 'string' && value.operationId.length > 0;
}

export function matchesFrameToolSession(
	session: FrameToolSession | null,
	operationId: string | undefined,
	senderTabId: number | undefined,
): session is FrameToolSession {
	return session !== null && operationId === session.operationId && senderTabId === session.tabId;
}
