// goal: keep the Popup's head script and the Popup module on one bootstrap contract
//
// The head script has to decide the theme and the frame before the browser's
// first paint, and a plain script the browser loads directly cannot import the
// Popup module. So it carries a placeholder token, and the build replaces that
// token with the keys the Popup module writes under. Writing them in both files
// would let them drift apart the first time either changed - the Popup would
// then reserve a height it never persists, and every open would jump again.

import {
	FRAME_HEIGHT_KEY_PLACEHOLDER,
	POPUP_BOOTSTRAP,
} from '../src/shared/popup-bootstrap.ts';

/**
 * Substitutes the placeholder in the head script with the bootstrap contract.
 *
 * Throws when the placeholder is absent: a head script that carries literal
 * keys (or none at all) would silently read different storage entries than the
 * Popup module writes, and the reservation would degrade into a jump.
 */
export function injectFrameHeightKey(source: string): string {
	if (!source.includes(FRAME_HEIGHT_KEY_PLACEHOLDER)) {
		throw new Error(
			'public/frame-reserve.js does not carry the popup bootstrap placeholder, so the '
			+ 'theme and frame hints it reads would drift from '
			+ 'src/shared/popup-bootstrap.ts.',
		);
	}
	// The token sits inside a single-quoted `JSON.parse` literal, and JSON never
	// contains a single quote, so the injected payload cannot end the string.
	return source.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, JSON.stringify(POPUP_BOOTSTRAP));
}
