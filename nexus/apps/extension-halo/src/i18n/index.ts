// goal: i18n core with React hook
// tradeoff: Simple key-path lookup, no heavy lib dependency

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { Locale, TranslationKeys } from './types';
import { en } from './locales/en';
import { zh } from './locales/zh';

// Mutable registry for dynamic updates
const REGISTRY: Record<Locale, TranslationKeys> = { en, zh };
const listeners = new Set<() => void>();

// Notify all listeners
const notify = () => listeners.forEach((l) => l());

// Register new translations (e.g. from downloaded modules)
export function registerTranslations(locale: Locale, data: Partial<TranslationKeys>) {
	// Simple shallow merge is usually sufficient for new modules adding unique top-level keys
	// If deep merge is needed, we can expand this
	REGISTRY[locale] = { ...REGISTRY[locale], ...data };
	notify();
}

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
	// Handle non-string values (e.g. objects) gracefully
	if (typeof current !== 'string') {
		// If it's an object/array, we might want to return it as is or JSON stringify
		// For now, strict string return relying on fallback
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

// Load saved locale
async function loadLocale(): Promise<Locale> {
	try {
		const result = await chrome.storage.sync.get(STORAGE_KEY);
		const saved = result[STORAGE_KEY] as Locale | undefined;
		if (saved && saved in REGISTRY) return saved;
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
	t: (path: string, options?: { defaultValue?: string }) => string;
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
	const [tick, setTick] = useState(0); // Force re-render on updates

	useEffect(() => {
		// Initial load
		loadLocale().then((l) => {
			setLocaleState(l);
			setReady(true);
		});

		// Subscribe to registry updates
		const onUpdate = () => setTick((t) => t + 1);
		listeners.add(onUpdate);
		return () => {
			listeners.delete(onUpdate);
		};
	}, []);

	const setLocale = useCallback((newLocale: Locale) => {
		setLocaleState(newLocale);
		saveLocale(newLocale);
	}, []);

	const t = useCallback((path: string, options?: { defaultValue?: string }): string => {
		const val = getByPath(REGISTRY[locale], path);
		if (val === path && options?.defaultValue) {
			return options.defaultValue;
		}
		return val;
	}, [locale, tick]); // Depend on tick to re-calc when registry changes

	const translations = REGISTRY[locale];

	return { locale, setLocale, t, translations, ready };
}

// Provider exports
export { I18nContext };
export type { Locale, TranslationKeys };
export { REGISTRY as LOCALES };
