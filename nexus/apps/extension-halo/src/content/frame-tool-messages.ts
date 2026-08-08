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
