// goal: i18n core with React hook
// tradeoff: Simple key-path lookup, no heavy lib dependency

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { Locale, TranslationKeys } from './types';
import { en } from './locales/en';
import { zh } from './locales/zh';

const STORAGE_KEY = 'halo_locale';

// Mutable registry for dynamic updates
const REGISTRY: Record<Locale, TranslationKeys> = { en, zh };
const listeners = new Set<() => void>();

// Internal global state to sync all hook instances
let globalLocale: Locale = 'en';
let i18nReady = false;

// Notify all listeners
const notify = () => listeners.forEach((l) => l());

// Register new translations (e.g. from downloaded modules)
export function registerTranslations(locale: Locale, data: Partial<TranslationKeys>) {
	REGISTRY[locale] = { ...REGISTRY[locale], ...data };
	notify();
}

// Get nested value by dot-path
function getByPath(obj: unknown, path: string): string {
	const parts = path.split('.');
	let current: unknown = obj;
	for (const part of parts) {
		if (current && typeof current === 'object' && part in current) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return path;
		}
	}
	if (typeof current !== 'string') {
		return typeof current === 'number' ? String(current) : path;
	}
	return current;
}

// Detect browser language
function detectLocale(): Locale {
	const lang = navigator.language.toLowerCase();
	if (lang.startsWith('zh')) return 'zh';
	return 'en';
}

// Initial sync load attempt with timeout
const I18N_INIT_TIMEOUT = 2000;

const initI18n = async () => {
	if (typeof chrome !== 'undefined' && chrome.storage) {
		try {
			const result = await Promise.race([
				chrome.storage.sync.get(STORAGE_KEY),
				new Promise<Record<string, unknown>>((resolve) =>
					setTimeout(() => {
						console.warn('[i18n] chrome.storage timeout, using browser locale');
						resolve({});
					}, I18N_INIT_TIMEOUT)
				)
			]);
			const saved = result[STORAGE_KEY] as Locale | undefined;
			if (saved && saved in REGISTRY) {
				globalLocale = saved;
			} else {
				globalLocale = detectLocale();
			}
		} catch {
			globalLocale = detectLocale();
		}
	} else {
		globalLocale = detectLocale();
	}
	i18nReady = true;
	notify();
};

// Start initialization
initI18n();

// Listen for external changes (syncs across multiple instances)
if (typeof chrome !== 'undefined' && chrome.storage) {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes[STORAGE_KEY]) {
			globalLocale = changes[STORAGE_KEY].newValue;
			i18nReady = true;
			notify();
		}
	});
}

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

		globalLocale = newLocale;
		i18nReady = true;

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
	}, [tick]); // tick changes on notify()

	const translations = REGISTRY[globalLocale];

	return { locale, setLocale, t, translations, ready };
}

// Provider exports
export { I18nContext };
export type { Locale, TranslationKeys };
export { REGISTRY as LOCALES };
