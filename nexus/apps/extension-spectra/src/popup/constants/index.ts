// goal: serves as the central aggregation point for all SPECTRA popup constants, ensuring consistent UI behavior

export { COLORS, popupColorToken, popupPrimaryColor } from './colors';
export type { ColorKey } from './colors';

export { AUDIO_UI } from './audio';

export { TIMING, UI_SIZES, VIZ_PARAMS } from './timing';

// The restricted-scheme list lives in `shared/restricted-url.ts`: the Background
// counts the cards a Popup will draw from the same predicate, and a second copy
// here would let the announcement disagree with the window it sizes.
export { RESTRICTED_URL_PREFIXES, isRestrictedUrl } from '../../shared/restricted-url';
