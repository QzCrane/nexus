// goal: manages internationalization for the options page, including language persistence and dynamic text injection

import type {
	SettingsUiSnapshot,
	SupportedLanguage,
} from '@nexus/contracts/ui-settings-runtime';
import {
	getOptionsSettingsSnapshot,
	patchOptionsSettings,
	subscribeOptionsSettingsSnapshots,
} from '../shared/options-settings-client';
import {
	getActionName,
	getOptionsDictionary,
	loadOptionsLocaleCatalog,
} from '../shared/i18n/options-catalog';
import { clearOptionsError, showOptionsError } from './status';

let currentLang: SupportedLanguage = 'en-US';
const onLangChangeCallbacks: (() => void)[] = [];
let latestObservedRevision = -1;
let projectionToken = 0;
let unsubscribeSettings: (() => void) | null = null;

function disposeI18nListeners(): void {
	unsubscribeSettings?.();
	unsubscribeSettings = null;
	projectionToken += 1;
}

async function projectLanguage(
	snapshot: SettingsUiSnapshot,
	select: HTMLSelectElement | null,
): Promise<boolean> {
	if (snapshot.revision < latestObservedRevision) return false;
	latestObservedRevision = snapshot.revision;
	const nextLang = snapshot.globalSettings.lang;
	const token = ++projectionToken;
	try {
		// Successful catalogs are cache hits. A same-language projection is still
		// passed to the catalog owner so a prior English fallback can retry its
		// localized asset instead of becoming permanent process state.
		await loadOptionsLocaleCatalog(nextLang);
	} catch (error) {
		// A superseded resource failure has no user-visible effect; the newest
		// projection owns both error reporting and the committed dictionary.
		if (token !== projectionToken) return false;
		throw error;
	}
	if (token !== projectionToken || snapshot.revision !== latestObservedRevision) return false;
	const languageChanged = nextLang !== currentLang;
	currentLang = nextLang;
	if (select) select.value = nextLang;
	clearOptionsError();
	applyI18n();
	if (languageChanged) onLangChangeCallbacks.forEach((callback) => { callback(); });
	return true;
}

export async function initI18n(): Promise<void> {
	disposeI18nListeners();
	const select = document.getElementById('lang-select') as HTMLSelectElement | null;
	latestObservedRevision = -1;
	unsubscribeSettings = subscribeOptionsSettingsSnapshots((snapshot) => {
		void projectLanguage(snapshot, select).catch(showOptionsError);
	});
	const initial = await getOptionsSettingsSnapshot();
	await projectLanguage(initial, select);
	// Replay a newer event that may have arrived while the locale asset was
	// fetched and decompressed, before any controls become interactive.
	await projectLanguage(await getOptionsSettingsSnapshot(), select);

	if (select) {
		select.onchange = async () => {
			const requestedLang = select.value as SupportedLanguage;
			try {
				const snapshot = await patchOptionsSettings({ scope: 'global', changes: { lang: requestedLang } });
				await projectLanguage(snapshot, select);
			} catch {
				select.value = currentLang;
				showOptionsError(new Error('Unable to save language preference'));
			}
		};
	}
	window.addEventListener('pagehide', disposeI18nListeners, { once: true });
}

function applyI18n(): void {
	const dict = getOptionsDictionary(currentLang);
	document.documentElement.lang = currentLang;

	document.querySelectorAll('[data-i18n]').forEach(el => {
		const key = el.getAttribute('data-i18n');
		if (key && dict[key]) el.textContent = dict[key];
	});

	document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
		const key = el.getAttribute('data-i18n-placeholder');
		if (key && dict[key]) el.placeholder = dict[key];
	});
}

export function t(key: string): string {
	return getOptionsDictionary(currentLang)[key] ?? key;
}

export function tf(key: string, values: Readonly<Record<string, string | number>>): string {
	let message = t(key);
	for (const [name, value] of Object.entries(values)) {
		message = message.replaceAll(`{${name}}`, String(value));
	}
	return message;
}

export function getCurrentLang(): string { return currentLang; }

export function onLangChange(callback: () => void): void { onLangChangeCallbacks.push(callback); }

export { getActionName };
