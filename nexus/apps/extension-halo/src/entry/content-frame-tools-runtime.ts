// goal: on-demand heavy runtime for release-admitted iframe-spanning HALO tools
// inv: This module is never part of a static content-script startup closure and contains no catalog-only implementation.

import {
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_RULER_START,
} from '../content/frame-tool-messages';
import * as Ruler from '../content/ruler';

type AdmittedFrameToolMessageType =
	| typeof FRAME_TOOL_RULER_START
	| typeof FRAME_TOOL_RULER_CANCEL;

export function handleFrameToolMessage(message: { type: AdmittedFrameToolMessageType }): boolean {
	switch (message.type) {
		case FRAME_TOOL_RULER_START:
			Ruler.start();
			return true;

		case FRAME_TOOL_RULER_CANCEL:
			Ruler.cancel();
			return true;
	}
}
