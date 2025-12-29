// goal: i18n core with React hook
// tradeoff: Simple key-path lookup, no heavy lib dependency

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { Locale, TranslationKeys } from './types';
import { en } from './locales/en';
import { zh } from './locales/zh';

const LOCALES: Record<Locale, TranslationKeys> = { en, zh };
const STORAGE_KEY = 'halo_locale';

// Get nested value by dot-path
function getByPath(obj: unknown, path: string): string {
	const parts = path.split('.');
	let current: unknown = obj;
	for (const part of parts) {
		if (current && typeof current === 'object' && part in current) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return path; // Fallback to key if not found
		}
	}
	return typeof current === 'string' ? current : path;
}

// Detect browser language
function detectLocale(): Locale {
	const lang = navigator.language.toLowerCase();
	if (lang.startsWith('zh')) return 'zh';
	return 'en';
}

// Load saved locale
async function loadLocale(): Promise<Locale> {
	try {
		const result = await chrome.storage.sync.get(STORAGE_KEY);
		const saved = result[STORAGE_KEY] as Locale | undefined;
		if (saved && saved in LOCALES) return saved;
	} catch {
		// Ignore errors in non-extension context
	}
	return detectLocale();
}

// Save locale preference
async function saveLocale(locale: Locale): Promise<void> {
	try {
		await chrome.storage.sync.set({ [STORAGE_KEY]: locale });
	} catch {
		// Ignore errors
	}
}

// i18n context
interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (path: string) => string;
	translations: TranslationKeys;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const useI18n = (): I18nContextValue => {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error('useI18n must be used within I18nProvider');
	return ctx;
};

// Simple hook for components (can be used standalone)
export function useTranslation() {
	const [locale, setLocaleState] = useState<Locale>('en');
	const [ready, setReady] = useState(false);

	useEffect(() => {
		loadLocale().then((l) => {
			setLocaleState(l);
			setReady(true);
		});
	}, []);

	const setLocale = useCallback((newLocale: Locale) => {
		setLocaleState(newLocale);
		saveLocale(newLocale);
	}, []);

	const t = useCallback((path: string): string => {
		return getByPath(LOCALES[locale], path);
	}, [locale]);

	const translations = LOCALES[locale];

	return { locale, setLocale, t, translations, ready };
}

// Provider exports
export { I18nContext };
export type { Locale, TranslationKeys };
export { LOCALES };
