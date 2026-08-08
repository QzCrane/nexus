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
import { subscribeHaloStorageChanges } from '../kernel/core/storage-change-bus';

export const STORAGE_KEY = 'halo_locale';

export const REGISTRY: Record<Locale, TranslationKeys> = { en, zh };
export const listeners = new Set<() => void>();

export let currentSetting: LocaleSetting = 'system';
export let resolvedLocale: Locale = 'en';
export let i18nReady = false;

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

export const notify = () => {
	for (const listener of [...listeners]) listener();
};

export function registerTranslations(locale: Locale, data: Partial<TranslationKeys>) {
	REGISTRY[locale] = { ...REGISTRY[locale], ...data };
	notify();
}

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

	if (params) {
		Object.entries(params).forEach(([key, value]) => {
			result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
		});
	}
	return result;
}

let resolveInit: (() => void) | null = null;
export const i18nPromise = new Promise<void>((resolvePromise) => {
	resolveInit = resolvePromise;
});

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

export const waitForI18n = () => i18nPromise;

initI18n().catch((error) => console.error('i18n init failed', error));

// Cross-instance locale changes share the SidePanel realm bus instead of
// registering another physical chrome.storage.onChanged callback.
if (typeof chrome !== 'undefined' && chrome.storage) {
	subscribeHaloStorageChanges((changes, area) => {
		if (area !== 'sync') return;
		const change = changes[STORAGE_KEY];
		if (!change) return;
		const newSetting: unknown = change.newValue;
		if (!isLocaleSetting(newSetting)) return;
		currentSetting = newSetting;
		resolvedLocale = resolve(newSetting);
		i18nReady = true;
		notify();
	});
}
