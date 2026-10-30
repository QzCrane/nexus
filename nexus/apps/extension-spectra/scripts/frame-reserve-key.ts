// goal: keep the Popup's head script and the Popup module on one frame height key
//
// The head script has to reserve the frame before the browser's first paint,
// and a plain script the browser loads directly cannot import the Popup
// module. So it carries a placeholder token, and the build replaces that token
// with the key the Popup module persists under. Writing the key in both files
// would let them drift apart the first time either changed - the Popup would
// then reserve a height it never persists, and every open would jump again.

import {
	FRAME_HEIGHT_KEY,
	FRAME_HEIGHT_KEY_PLACEHOLDER,
} from '../src/popup/constants/frame-height.ts';

/**
 * Substitutes the placeholder in the head script with the real hint key.
 *
 * Throws when the placeholder is absent: a head script that carries a literal
 * key (or none at all) would silently read a different storage entry than the
 * Popup module writes, and the reservation would degrade into a jump.
 */
export function injectFrameHeightKey(source: string): string {
	if (!source.includes(FRAME_HEIGHT_KEY_PLACEHOLDER)) {
		throw new Error(
			'public/frame-reserve.js does not carry the frame height placeholder, so the '
			+ 'hint key it reads would drift from src/popup/constants/frame-height.ts.',
		);
	}
	return source.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, FRAME_HEIGHT_KEY);
}
