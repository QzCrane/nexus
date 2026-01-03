// goal: i18n hook and context
// eff: Delegates core logic to i18n-core.ts

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { Locale, TranslationKeys, LocaleSetting } from './types';
import {
	STORAGE_KEY,
	REGISTRY,
	listeners,
	currentSetting,
	resolvedLocale,
	i18nReady,
	setGlobalLocale,
	setI18nReady,
	notify,
	getByPath,
	registerTranslations,
	waitForI18n,
	detectLocale,
} from './i18n-core';

// Re-export core functions
export { registerTranslations, waitForI18n, detectLocale };

// i18n context
interface I18nContextValue {
	locale: Locale;
	setting: LocaleSetting;
	setLocale: (setting: LocaleSetting) => void;
	t: (path: string, options?: { defaultValue?: string } & Record<string, any>) => string;
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
	const [locale, setLocale] = useState<Locale>(resolvedLocale);
	const [setting, setSetting] = useState<LocaleSetting>(currentSetting);
	const [ready, setReady] = useState(i18nReady);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const onUpdate = () => {
			setLocale(resolvedLocale);
			setSetting(currentSetting);
			setReady(i18nReady);
			setTick((t) => t + 1);
		};
		listeners.add(onUpdate);
		return () => {
			listeners.delete(onUpdate);
		};
	}, []);

	const updateLocale = useCallback(async (newSetting: LocaleSetting) => {
		if (newSetting === currentSetting) return;

		setGlobalLocale(newSetting);
		setI18nReady(true);

		if (typeof chrome !== 'undefined' && chrome.storage) {
			await chrome.storage.sync.set({ [STORAGE_KEY]: newSetting });
		}
		notify();
	}, []);

	const t = useCallback((path: string, options?: { defaultValue?: string } & Record<string, any>): string => {
		const { defaultValue, ...params } = options || {};
		const val = getByPath(REGISTRY[resolvedLocale], path, params);

		if (val === path && defaultValue) {
			// If key not found (val === path), return defaultValue
			let result = defaultValue;
			Object.entries(params).forEach(([key, value]) => {
				result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
			});
			return result;
		}
		return val;
	}, [tick]);

	const translations = REGISTRY[resolvedLocale];

	return { locale, setting, setLocale: updateLocale, t, translations, ready };
}

// Provider exports
export { I18nContext };
export type { Locale, LocaleSetting, TranslationKeys };
export { REGISTRY as LOCALES };

