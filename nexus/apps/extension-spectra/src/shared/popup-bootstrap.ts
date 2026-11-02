// goal: the contract between the Background and the Action Popup about how the
// Popup will look before it exists
//
// Two facts about an Action Popup cannot wait for an asynchronous read: the
// theme it paints in, and the height the window opens at. Both are decided from
// this module. The Background states the card count in the Popup's URL - it is
// the only surface that can count media tabs before the document exists - and
// the render-blocking head script turns that count into a height and a colour
// before the first paint. The Popup module then records the height each shape
// settled on, so the next open of that shape needs no correction at all.
//
// The height is recorded per card count, not as one number. A single hint is a
// promise about the *previous* open's shape: open a two-card Popup and the next
// one-card Popup inherits a height it can never use, so every switch between
// shapes had to resize the window in front of the user. Keyed by the count, the
// height belongs to the shape that is about to be drawn.

import type { SupportedLanguage } from '@nexus/contracts';
import { normalizeLanguage } from './i18n/locale-sections';

/** Prefix of the per-count frame heights; `<prefix>.<cards>` holds one shape. */
export const FRAME_HEIGHT_KEY_PREFIX = 'spectra.popup.frame';

/** The most recent settled height, regardless of shape. Fallback only. */
export const FRAME_HEIGHT_KEY_LAST = `${FRAME_HEIGHT_KEY_PREFIX}.last`;

/**
 * The single-hint key earlier versions wrote. Still read once so the first open
 * after an update keeps the height the previous version learned instead of
 * paying a jump to re-learn it.
 */
export const FRAME_HEIGHT_KEY = 'spectra.popup.frameHeight';

/**
 * Query parameter the Background uses to state how many cards the Popup it is
 * about to open will render. It is the one layout fact that exists before the
 * document does: the Background can count the media tabs, the document cannot.
 */
export const FRAME_PLAN_PARAM = 'cards';
export const POPUP_MAIN_PARAM = 'main';
export const POPUP_LANGUAGE_PARAM = 'lang';
export const POPUP_VISUALIZER_PARAM = 'viz';

export interface PopupAppearance {
	hasMainCard: boolean;
	language: SupportedLanguage;
	visualizerEnabled: boolean;
}

export function readPopupAppearance(search: string): PopupAppearance | null {
	const query = new URLSearchParams(search);
	const main = query.get(POPUP_MAIN_PARAM);
	const language = query.get(POPUP_LANGUAGE_PARAM);
	const visualizer = query.get(POPUP_VISUALIZER_PARAM);
	if ((main !== '0' && main !== '1') || !language || (visualizer !== '0' && visualizer !== '1')) return null;
	const normalizedLanguage = normalizeLanguage(language);
	if (normalizedLanguage !== language) return null;
	return { hasMainCard: main === '1', language: normalizedLanguage, visualizerEnabled: visualizer === '1' };
}

/** The Action Popup's document path, with the announced count attached. */
export const ACTION_POPUP_PATH = 'popup.html';

/** The stored `ThemeMode`, so the first paint is already in the user's theme. */
export const THEME_MODE_KEY = 'spectra.popup.themeMode';

/** Chrome grants an Action Popup at most this much height. */
export const FRAME_MAX_HEIGHT_PX = 600;

/** post: the storage key holding the settled height of a `cards`-card Popup */
export function frameHeightKeyForCards(cards: number): string {
	return `${FRAME_HEIGHT_KEY_PREFIX}.${cards}`;
}

/**
 * post: the URL the action should open for a tab whose Popup will draw `cards`
 * cards, or the bare document when the count could not be decided
 */
export function actionPopupPath(cards: number | null, appearance?: PopupAppearance): string {
	if (cards === null || !Number.isSafeInteger(cards) || cards < 0 || cards > 999) {
		return ACTION_POPUP_PATH;
	}
	const query = new URLSearchParams({ [FRAME_PLAN_PARAM]: String(cards) });
	if (appearance) {
		query.set(POPUP_MAIN_PARAM, appearance.hasMainCard ? '1' : '0');
		query.set(POPUP_LANGUAGE_PARAM, appearance.language);
		query.set(POPUP_VISUALIZER_PARAM, appearance.visualizerEnabled ? '1' : '0');
	}
	return `${ACTION_POPUP_PATH}?${query}`;
}

/**
 * What the head script receives. Injected as JSON by the build so the head
 * script cannot carry a second definition of any of these strings.
 */
export const POPUP_BOOTSTRAP = {
	prefix: FRAME_HEIGHT_KEY_PREFIX,
	lastKey: FRAME_HEIGHT_KEY_LAST,
	legacyKey: FRAME_HEIGHT_KEY,
	param: FRAME_PLAN_PARAM,
	themeKey: THEME_MODE_KEY,
	surface: 'action-popup',
	maxHeight: FRAME_MAX_HEIGHT_PX,
} as const;

/**
 * The token the head script carries until the build replaces it with
 * `POPUP_BOOTSTRAP`. A literal copy in the head script would be a second
 * definition of the same strings, and the two would drift apart the first time
 * either changed.
 */
export const FRAME_HEIGHT_KEY_PLACEHOLDER = '__SPECTRA_POPUP_BOOTSTRAP__';
