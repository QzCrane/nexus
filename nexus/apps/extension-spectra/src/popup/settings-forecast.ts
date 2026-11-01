// goal: let the first card be drawn in the shape the user's settings give it
//
// A card's height is not a constant: the visualizer island is a fixed band of
// every card, and turning the visualizer off removes it. That setting arrives
// with the settings snapshot, which lands *after* the cards are committed - so a
// user who turned the visualizer off watched every card shrink a moment after the
// Popup had already settled, and the window followed it. The same late change
// taught the frame plan a height this content never keeps.
//
// The last committed settings are therefore cached here and stand in until the
// authoritative snapshot arrives. This is a forecast, not state: every field is
// validated on the way in, the first projection overwrites it, and a card
// re-renders from the real settings as soon as they land.

import type { GlobalSettings } from '@nexus/kernel';

const SETTINGS_FORECAST_KEY = 'spectra.popup.settingsForecast.v1';

function isGlobalSettings(value: unknown): value is GlobalSettings {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.osdEnabled === 'boolean'
		&& typeof candidate.visualizerEnabled === 'boolean'
		&& typeof candidate.lang === 'string'
		&& (candidate.themeMode === 'light'
			|| candidate.themeMode === 'dark'
			|| candidate.themeMode === 'system')
		&& typeof candidate.pauseRetentionSeconds === 'number'
		&& Number.isFinite(candidate.pauseRetentionSeconds);
}

/** post: the last committed global settings, or null when none were recorded */
export function readSettingsForecast(): GlobalSettings | null {
	let raw: string | null;
	try {
		raw = window.localStorage.getItem(SETTINGS_FORECAST_KEY);
	} catch (error) {
		console.debug('[SPECTRA Popup] Settings forecast unreadable:', error);
		return null;
	}
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isGlobalSettings(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

// eff: records what the settings projection committed, for the next first paint
export function writeSettingsForecast(settings: GlobalSettings): void {
	try {
		window.localStorage.setItem(SETTINGS_FORECAST_KEY, JSON.stringify({
			osdEnabled: settings.osdEnabled,
			visualizerEnabled: settings.visualizerEnabled,
			lang: settings.lang,
			themeMode: settings.themeMode,
			pauseRetentionSeconds: settings.pauseRetentionSeconds,
		} satisfies GlobalSettings));
	} catch (error) {
		console.debug('[SPECTRA Popup] Settings forecast not persisted:', error);
	}
}
