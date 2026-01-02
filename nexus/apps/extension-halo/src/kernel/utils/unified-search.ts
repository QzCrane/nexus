// goal: Unified search engine with multi-language & Pinyin support
// eff: High extensibility - auto-detects all registered locales
// tradeoff: Imports all locale files, acceptable for sidepanel context

import { pinyin } from 'pinyin-pro';
import type { Locale } from '../../i18n/types';

// ==============================
// TYPES
// ==============================

export interface SearchableItem {
	id: string;
	keywords?: string[];
}

export interface SearchOptions {
	/** Fields to search in i18n (e.g., ['name', 'desc']) */
	fields?: string[];
	/** i18n key prefix (e.g., 'tools' for `tools.${id}.name`) */
	i18nPrefix?: string;
	/** Include Pinyin search for CJK text */
	enablePinyin?: boolean;
	/** Custom matcher for additional logic */
	customMatcher?: (item: SearchableItem, query: string) => boolean;
}

interface LocaleRegistry {
	[locale: string]: Record<string, any>;
}

// ==============================
// LOCALE REGISTRY (Auto-expandable)
// ==============================

const localeRegistry: LocaleRegistry = {};

/**
 * Register a locale for search indexing
 * Call this when adding new languages - search auto-supports them
 */
export function registerSearchLocale(locale: Locale, data: Record<string, any>) {
	localeRegistry[locale] = data;
}

// Auto-register built-in locales
import { en } from '../../i18n/locales/en';
import { zh } from '../../i18n/locales/zh';
registerSearchLocale('en', en);
registerSearchLocale('zh', zh);

// ==============================
// PINYIN UTILITIES
// ==============================

const CJK_REGEX = /[\u4e00-\u9fa5\u3400-\u4dbf]/;

function hasCJK(text: string): boolean {
	return CJK_REGEX.test(text);
}

function getPinyinVariants(text: string): string[] {
	if (!hasCJK(text)) return [];

	const variants: string[] = [];
	try {
		// Full Pinyin (e.g., "erweima")
		const full = pinyin(text, { toneType: 'none', type: 'array' }).join('');
		if (full) variants.push(full);

		// Initial Pinyin (e.g., "ewm")
		const initial = pinyin(text, { pattern: 'initial', toneType: 'none', type: 'array' }).join('');
		if (initial) variants.push(initial);
	} catch {
		// Pinyin library may fail on edge cases
	}
	return variants;
}

// ==============================
// CORE SEARCH ENGINE
// ==============================

function normalizeQuery(str: string): string {
	if (!str) return '';
	return str.toLowerCase().replace(/\s+/g, '').trim();
}

/**
 * Get all searchable texts for an item across all registered locales
 */
function getSearchableTexts(
	item: SearchableItem,
	options: SearchOptions
): string[] {
	const texts: string[] = [];
	const { fields = ['name', 'desc'], i18nPrefix = 'tools', enablePinyin = true } = options;

	// Iterate all registered locales
	for (const [_locale, localeData] of Object.entries(localeRegistry)) {
		const itemData = localeData[i18nPrefix]?.[item.id];
		if (!itemData) continue;

		for (const field of fields) {
			const value = itemData[field];
			if (typeof value === 'string') {
				texts.push(value);

				// Add Pinyin variants for CJK text
				if (enablePinyin) {
					texts.push(...getPinyinVariants(value));
				}
			}
		}
	}

	// Add keywords
	if (item.keywords?.length) {
		texts.push(...item.keywords);
	}

	return texts;
}

/**
 * Universal search matcher
 * @param item Item to check
 * @param query Search query
 * @param options Search configuration
 * @returns true if item matches query
 */
export function matchItem<T extends SearchableItem>(
	item: T,
	query: string,
	options: SearchOptions = {}
): boolean {
	if (!query) return false;

	const q = normalizeQuery(query);
	if (!q) return false;

	// 1. ID match (highest priority)
	if (item.id.includes(q)) return true;

	// 2. Custom matcher
	if (options.customMatcher?.(item, q)) return true;

	// 3. Multi-locale + Pinyin search
	const searchableTexts = getSearchableTexts(item, options);
	return searchableTexts.some(text =>
		text && normalizeQuery(text).includes(q)
	);
}

/**
 * Filter array of items by search query
 */
export function filterBySearch<T extends SearchableItem>(
	items: T[],
	query: string,
	options: SearchOptions = {}
): T[] {
	if (!query?.trim()) return items;
	return items.filter(item => matchItem(item, query, options));
}

// ==============================
// PREBUILT SEARCH CONFIGS
// ==============================

/** Default search config for tools */
export const TOOL_SEARCH_OPTIONS: SearchOptions = {
	fields: ['name', 'desc'],
	i18nPrefix: 'tools',
	enablePinyin: true,
};

/** Search config for module store (same as tools) */
export const MODULE_SEARCH_OPTIONS: SearchOptions = {
	...TOOL_SEARCH_OPTIONS,
};

// ==============================
// RE-EXPORTS FOR COMPATIBILITY
// ==============================

export { normalizeQuery as normalizeSearch };
