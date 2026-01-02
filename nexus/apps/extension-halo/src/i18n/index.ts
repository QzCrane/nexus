// goal: i18n hook and context
// eff: Delegates core logic to i18n-core.ts

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { Locale, TranslationKeys } from './types';
import {
	STORAGE_KEY,
	REGISTRY,
	listeners,
	globalLocale,
	i18nReady,
	setGlobalLocale,
	setI18nReady,
	notify,
	getByPath,
	registerTranslations,
	waitForI18n,
} from './i18n-core';

// Re-export core functions
export { registerTranslations, waitForI18n };

// i18n context
interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (path: string, options?: { defaultValue?: string }) => string;
	translations: TranslationKeys;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const useI18n = (): I18nContextValue => {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error('useI18n must be used within I18nProvider');
	return ctx;
};

// Optimized hook that syncs globally across all components
export function useTranslation() {
	const [locale, setLocaleState] = useState<Locale>(globalLocale);
	const [ready, setReady] = useState(i18nReady);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const onUpdate = () => {
			setLocaleState(globalLocale);
			setReady(i18nReady);
			setTick((t) => t + 1);
		};
		listeners.add(onUpdate);
		return () => {
			listeners.delete(onUpdate);
		};
	}, []);

	const setLocale = useCallback(async (newLocale: Locale) => {
		if (newLocale === globalLocale) return;

		setGlobalLocale(newLocale);
		setI18nReady(true);

		if (typeof chrome !== 'undefined' && chrome.storage) {
			await chrome.storage.sync.set({ [STORAGE_KEY]: newLocale });
		}
		notify();
	}, []);

	const t = useCallback((path: string, options?: { defaultValue?: string }): string => {
		const val = getByPath(REGISTRY[globalLocale], path);
		if (val === path && options?.defaultValue) {
			return options.defaultValue;
		}
		return val;
	}, [tick]);

	const translations = REGISTRY[globalLocale];

	return { locale, setLocale, t, translations, ready };
}

// Provider exports
export { I18nContext };
export type { Locale, TranslationKeys };
export { REGISTRY as LOCALES };

