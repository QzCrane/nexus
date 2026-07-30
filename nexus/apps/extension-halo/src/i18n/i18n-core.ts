// goal: i18n core logic (initialization + locale management)
// eff: Separated from hook for better modularity

import type {
	Locale,
	LocaleSetting,
	TranslationKeys,
	TranslationParams,
} from './types';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { safeStorageGet } from '../kernel/core/safe-storage';

export const STORAGE_KEY = 'halo_locale';

// Mutable registry for dynamic updates
export const REGISTRY: Record<Locale, TranslationKeys> = { en, zh };
export const listeners = new Set<() => void>();

// Internal global state
export let currentSetting: LocaleSetting = 'system';
export let resolvedLocale: Locale = 'en';
export let i18nReady = false;

// Detect browser language
export function detectLocale(): Locale {
	const lang = navigator.language.toLowerCase();
	if (lang.startsWith('zh')) return 'zh';
	return 'en';
}

function resolve(setting: LocaleSetting): Locale {
	if (setting === 'system') return detectLocale();
	return setting;
}

function isLocaleSetting(value: unknown): value is LocaleSetting {
	return value === 'en' || value === 'zh' || value === 'system';
}

export function setGlobalLocale(setting: LocaleSetting) {
	currentSetting = setting;
	resolvedLocale = resolve(setting);
	notify();
}

export function setI18nReady(ready: boolean) {
	i18nReady = ready;
}

// Notify all listeners
export const notify = () => listeners.forEach((listener) => {
	listener();
});

// Register new translations (e.g. from downloaded modules)
export function registerTranslations(locale: Locale, data: Partial<TranslationKeys>) {
	REGISTRY[locale] = { ...REGISTRY[locale], ...data };
	notify();
}

// Get nested value by dot-path and interpolate
export function getByPath(obj: unknown, path: string, params?: TranslationParams): string {
	const parts = path.split('.');
	let current: unknown = obj;
	for (const part of parts) {
		if (current && typeof current === 'object' && part in current) {
			current = (current as Record<string, unknown>)[part];
		} else {
			return path;
		}
	}

	let result = path;
	if (typeof current === 'string') {
		result = current;
	} else if (typeof current === 'number') {
		result = String(current);
	} else {
		return path;
	}

	// Interpolate specific params if provided
	if (params) {
		Object.entries(params).forEach(([key, value]) => {
			result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
		});
	}

	return result;
}

// Promise for async initialization (Suspense-compatible)
let resolveInit: (() => void) | null = null;
export const i18nPromise = new Promise<void>((resolve) => {
	resolveInit = resolve;
});

// Initialize i18n
export const initI18n = async () => {
	if (typeof chrome !== 'undefined' && chrome.storage) {
		try {
			const result = await safeStorageGet(
				[STORAGE_KEY],
				{ [STORAGE_KEY]: 'system' },
			);
			const saved: unknown = result[STORAGE_KEY];
			currentSetting = isLocaleSetting(saved) ? saved : 'system';
		} catch {
			currentSetting = 'system';
		}
	} else {
		currentSetting = 'system';
	}

	resolvedLocale = resolve(currentSetting);

	i18nReady = true;
	resolveInit?.();
	notify();
};

/**
 * Wait for i18n to be ready
 * Usage: await waitForI18n();
 */
export const waitForI18n = () => i18nPromise;

// Start initialization
// rule: swallow rejection so the floating promise doesn't throw an unhandled
// rejection. initI18n already catches its own internal errors, but defensive
// .catch guards against future regressions.
initI18n().catch((e) => console.error('i18n init failed', e));

// Listen for external changes (syncs across multiple instances)
if (typeof chrome !== 'undefined' && chrome.storage) {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes[STORAGE_KEY]) {
			const newSetting: unknown = changes[STORAGE_KEY].newValue;
			if (!isLocaleSetting(newSetting)) return;
			currentSetting = newSetting;
			resolvedLocale = resolve(newSetting);
			i18nReady = true;
			notify();
		}
	});
}
