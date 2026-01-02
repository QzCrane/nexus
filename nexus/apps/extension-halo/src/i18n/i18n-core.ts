// goal: i18n core logic (initialization + locale management)
// eff: Separated from hook for better modularity

import type { Locale, TranslationKeys } from './types';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { safeStorageGet } from '../kernel/core/safe-storage';

export const STORAGE_KEY = 'halo_locale';

// Mutable registry for dynamic updates
export const REGISTRY: Record<Locale, TranslationKeys> = { en, zh };
export const listeners = new Set<() => void>();

// Internal global state
export let globalLocale: Locale = 'en';
export let i18nReady = false;

export function setGlobalLocale(locale: Locale) {
	globalLocale = locale;
}

export function setI18nReady(ready: boolean) {
	i18nReady = ready;
}

// Notify all listeners
export const notify = () => listeners.forEach((l) => l());

// Register new translations (e.g. from downloaded modules)
export function registerTranslations(locale: Locale, data: Partial<TranslationKeys>) {
	REGISTRY[locale] = { ...REGISTRY[locale], ...data };
	notify();
}

// Get nested value by dot-path
export function getByPath(obj: unknown, path: string): string {
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
export function detectLocale(): Locale {
	const lang = navigator.language.toLowerCase();
	if (lang.startsWith('zh')) return 'zh';
	return 'en';
}

// Initialize i18n
export const initI18n = async () => {
	if (typeof chrome !== 'undefined' && chrome.storage) {
		try {
			const result = await safeStorageGet([STORAGE_KEY], { [STORAGE_KEY]: undefined } as Partial<Record<string, unknown>>);
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
