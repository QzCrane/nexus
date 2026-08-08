// goal: one tiny message-name authority shared by the static frame bootstrap and lazy runtime
// inv: Keep this module data-only so importing it cannot create frame startup work.

export const FRAME_TOOL_MESSAGE = Object.freeze({
	RULER_START: 'HALO_RULER_START',
	RULER_CANCEL: 'HALO_RULER_CANCEL',
	DOM_SELECTOR_START: 'HALO_DOM_SELECTOR_START',
	DOM_SELECTOR_STOP: 'HALO_DOM_SELECTOR_STOP',
	ANNOTATE_START: 'HALO_ANNOTATE_START',
	ANNOTATE_STOP: 'HALO_ANNOTATE_STOP',
} as const);

export type FrameToolMessageType = typeof FRAME_TOOL_MESSAGE[keyof typeof FRAME_TOOL_MESSAGE];

export const FRAME_TOOL_MESSAGE_TYPES = Object.freeze(
	Object.values(FRAME_TOOL_MESSAGE) as FrameToolMessageType[],
);

export const FRAME_TOOL_DEACTIVATION_TYPES = Object.freeze([
	FRAME_TOOL_MESSAGE.RULER_CANCEL,
	FRAME_TOOL_MESSAGE.DOM_SELECTOR_STOP,
	FRAME_TOOL_MESSAGE.ANNOTATE_STOP,
] as const satisfies readonly FrameToolMessageType[]);
