// goal: one owner for the frame height hint key
//
// The hint is read in two places: the render-blocking head script, which has to
// reserve the frame before the first paint, and the Popup module, which
// persists the settled height. The head script is a plain file the browser
// loads directly, so it cannot import this module - the build injects the key
// into the shipped copy instead. One constant, one key, and no second place
// where a rename could be forgotten.

/** The storage key the settled Popup frame height is written under. */
export const FRAME_HEIGHT_KEY = 'spectra.popup.frameHeight';

/**
 * The token the head script carries until the build replaces it with the key
 * above. A literal key in the head script would be a second definition of the
 * same string, and the two would drift apart the first time either changed.
 */
export const FRAME_HEIGHT_KEY_PLACEHOLDER = '__SPECTRA_FRAME_HEIGHT_KEY__';
