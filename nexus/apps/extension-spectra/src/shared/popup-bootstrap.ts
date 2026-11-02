// goal: the single presentation contract announced before the Popup exists
// inv: counts create real template slots; intrinsic content owns height

import type { SupportedLanguage } from '@nexus/contracts';
import { normalizeLanguage } from './i18n/locale-sections';
import { MAX_PAUSE_RETENTION_SECONDS } from '@nexus/contracts/ui-runtime';

/**
 * Query parameter the Background uses to state how many cards the Popup it is
 * about to open will render. It is the one layout fact that exists before the
 * document does: the Background can count the media tabs, the document cannot.
 */
export const FRAME_PLAN_PARAM = 'cards';
export const POPUP_MAIN_PARAM = 'main';
export const POPUP_LANGUAGE_PARAM = 'lang';
export const POPUP_VISUALIZER_PARAM = 'viz';
export const POPUP_RETENTION_PARAM = 'retain';
export const POPUP_EXPIRIES_PARAM = 'expires';

export interface PopupAppearance {
	hasMainCard: boolean;
	language: SupportedLanguage;
	visualizerEnabled: boolean;
	pauseRetentionSeconds?: number;
	/** Anonymous background-card deadlines only; never tab or document identity. */
	backgroundExpiries?: number[];
}

export function readPopupAppearance(search: string): PopupAppearance | null {
	const query = new URLSearchParams(search);
	const main = query.get(POPUP_MAIN_PARAM);
	const language = query.get(POPUP_LANGUAGE_PARAM);
	const visualizer = query.get(POPUP_VISUALIZER_PARAM);
	if ((main !== '0' && main !== '1') || !language || (visualizer !== '0' && visualizer !== '1')) return null;
	const normalizedLanguage = normalizeLanguage(language);
	if (normalizedLanguage !== language) return null;
	const retention = query.get(POPUP_RETENTION_PARAM);
	const seconds = retention === null ? undefined : Number(retention);
	if (seconds !== undefined && (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_PAUSE_RETENTION_SECONDS)) return null;
	const expires = query.get(POPUP_EXPIRIES_PARAM);
	let backgroundExpiries: number[] | undefined;
	if (expires !== null) {
		try {
			const parsed: unknown = JSON.parse(expires);
			if (!Array.isArray(parsed) || parsed.length > 999 || !parsed.every((at) => Number.isSafeInteger(at) && Number(at) > 0)) return null;
			backgroundExpiries = parsed;
		} catch { return null; }
	}
	return { hasMainCard: main === '1', language: normalizedLanguage, visualizerEnabled: visualizer === '1',
		...(seconds === undefined ? {} : { pauseRetentionSeconds: seconds }), ...(backgroundExpiries === undefined ? {} : { backgroundExpiries }) };
}

/** Synchronous display-only projection; it remains correct if the worker slept past a deadline. */
export function readAnnouncedBackgroundCount(search: string, now = Date.now()): number | null {
	const appearance = readPopupAppearance(search);
	const count = new URLSearchParams(search).get(FRAME_PLAN_PARAM);
	if (!appearance || count === null || !/^\d{1,3}$/u.test(count)) return null;
	const backgroundCount = Math.max(0, Number(count) - Number(appearance.hasMainCard));
	if ((appearance.backgroundExpiries?.length ?? 0) > backgroundCount) return null;
	return backgroundCount - (appearance.backgroundExpiries?.filter((at) => at <= now).length ?? 0);
}

/** The Action Popup's document path, with the announced count attached. */
export const ACTION_POPUP_PATH = 'popup.html';

/** The stored `ThemeMode`, so the first paint is already in the user's theme. */
export const THEME_MODE_KEY = 'spectra.popup.themeMode';

/** Chrome grants an Action Popup at most this much height. */
export const FRAME_MAX_HEIGHT_PX = 600;

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
		if (appearance.pauseRetentionSeconds !== undefined) query.set(POPUP_RETENTION_PARAM, String(appearance.pauseRetentionSeconds));
		if (appearance.backgroundExpiries?.length) query.set(POPUP_EXPIRIES_PARAM, JSON.stringify(appearance.backgroundExpiries));
	}
	return `${ACTION_POPUP_PATH}?${query}`;
}

/**
 * What the head script receives. Injected as JSON by the build so the head
 * script cannot carry a second definition of any of these strings.
 */
export const POPUP_BOOTSTRAP = {
	themeKey: THEME_MODE_KEY,
	surface: 'action-popup',
} as const;

/**
 * The token the head script carries until the build replaces it with
 * `POPUP_BOOTSTRAP`. A literal copy in the head script would be a second
 * definition of the same strings, and the two would drift apart the first time
 * either changed.
 */
export const FRAME_HEIGHT_KEY_PLACEHOLDER = '__SPECTRA_POPUP_BOOTSTRAP__';
