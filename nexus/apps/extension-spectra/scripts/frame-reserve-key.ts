// goal: keep the Popup's head script and the Popup module on one bootstrap contract
//
// The classic head script establishes theme/surface before paint and cannot
// import a module. Build injection shares those keys with the module owner;
// card structure and live geometry do not use historical height hints.

import {
	FRAME_HEIGHT_KEY_PLACEHOLDER,
	POPUP_BOOTSTRAP,
} from '../src/shared/popup-bootstrap.ts';

/**
 * Substitutes the placeholder in the head script with the bootstrap contract.
 *
 * Throws when the placeholder is absent: a head script that carries literal
 * keys (or none at all) would silently diverge from the shared bootstrap owner.
 */
export function injectFrameHeightKey(source: string): string {
	if (!source.includes(FRAME_HEIGHT_KEY_PLACEHOLDER)) {
		throw new Error(
			'public/frame-reserve.js does not carry the popup bootstrap placeholder, so the '
			+ 'theme and surface it reads would drift from '
			+ 'src/shared/popup-bootstrap.ts.',
		);
	}
	// The token sits inside a single-quoted `JSON.parse` literal, and JSON never
	// contains a single quote, so the injected payload cannot end the string.
	return source.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, JSON.stringify(POPUP_BOOTSTRAP));
}
