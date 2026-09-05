import type { SupportedLanguage } from '@nexus/contracts';

export type EncodedLocaleSectionAsset = Record<string, string> | string[];

export const SUPPORTED_SPECTRA_LANGUAGES = [
	'en-US',
	'zh-CN',
	'zh-TW',
	'ja-JP',
	'ko-KR',
	'es-ES',
	'ru-RU',
	'de-DE',
	'fr-FR',
] as const satisfies readonly SupportedLanguage[];

export const MAX_CACHED_LOCALE_SECTIONS = 2;

export function normalizeLanguage(language: string): SupportedLanguage {
	return SUPPORTED_SPECTRA_LANGUAGES.includes(language as SupportedLanguage)
		? language as SupportedLanguage
		: 'en-US';
}

export function sourceLanguage(language: SupportedLanguage): SupportedLanguage {
	return language;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& Object.values(value).every((item) => typeof item === 'string');
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseLocaleSection(value: unknown): EncodedLocaleSectionAsset {
	if (isStringRecord(value) || isStringArray(value)) return value;
	throw new Error('Locale section has an invalid schema');
}

export function requireEnglishSection(asset: EncodedLocaleSectionAsset): Record<string, string> {
	if (Array.isArray(asset)) throw new Error('English locale section must contain named keys');
	return asset;
}

export async function decodeLocaleSectionResponse(
	response: Response,
	label: string,
): Promise<EncodedLocaleSectionAsset> {
	if (!response.ok || !response.body) throw new Error(`Unable to load ${label}`);
	const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
	return parseLocaleSection(JSON.parse(await new Response(decompressed).text()));
}

export function decodeLocaleSection(
	asset: EncodedLocaleSectionAsset,
	english: Record<string, string>,
): Record<string, string> {
	const keys = Object.keys(english);
	if (Array.isArray(asset)) {
		if (asset.length !== keys.length) throw new Error('Locale catalog has an invalid dense section');
		return Object.fromEntries(keys.map((key, index) => [key, asset[index] ?? '']));
	}
	const decoded: Record<string, string> = {};
	for (const [rawIndex, value] of Object.entries(asset)) {
		if (!/^(?:0|[1-9]\d*)$/u.test(rawIndex)) {
			throw new Error('Locale catalog has a non-numeric delta key');
		}
		const key = keys[Number(rawIndex)];
		if (!key) throw new Error('Locale catalog delta index is out of range');
		decoded[key] = value;
	}
	return decoded;
}

export interface LocaleSectionStore {
	cache: Map<SupportedLanguage, Record<string, string>>;
	loads: Map<SupportedLanguage, Promise<Record<string, string>>>;
	english: {
		cache: Record<string, string> | null;
		load: Promise<Record<string, string>> | null;
	};
	fallbacks: Set<SupportedLanguage>;
}

export function cacheLocaleValue<T>(cache: Map<SupportedLanguage, T>, language: string, value: T): void {
	const normalized = normalizeLanguage(language);
	cache.delete(normalized);
	while (cache.size >= MAX_CACHED_LOCALE_SECTIONS) {
		const oldest = cache.keys().next().value as SupportedLanguage | undefined;
		if (!oldest) break;
		cache.delete(oldest);
	}
	cache.set(normalized, value);
}

export function cacheLocaleSection(
	store: LocaleSectionStore,
	language: string,
	section: Record<string, string>,
): void {
	cacheLocaleValue(store.cache, language, section);
}

export function createLocaleSectionStore(): LocaleSectionStore {
	return {
		cache: new Map(),
		loads: new Map(),
		english: { cache: null, load: null },
		fallbacks: new Set(),
	};
}

export function clearLocaleSectionStore(store: LocaleSectionStore): void {
	store.cache.clear();
	store.english.cache = null;
	store.english.load = null;
	store.fallbacks.clear();
}

export type LocaleSectionFetcher = (language: SupportedLanguage) => Promise<EncodedLocaleSectionAsset>;

export async function loadLocaleSection(
	language: string,
	store: LocaleSectionStore,
	fetchSection: LocaleSectionFetcher,
): Promise<Record<string, string>> {
	const normalized = normalizeLanguage(language);
	if (store.fallbacks.delete(normalized)) store.cache.delete(normalized);
	const cached = store.cache.get(normalized);
	if (cached) {
		cacheLocaleValue(store.cache, normalized, cached);
		return cached;
	}
	const pending = store.loads.get(normalized);
	if (pending) return pending;
	const load = (async () => {
		if (!store.english.cache) {
			store.english.load ??= fetchSection('en-US').then(requireEnglishSection);
			try {
				store.english.cache = await store.english.load;
			} finally {
				store.english.load = null;
			}
		}
		const english = store.english.cache;
		if (!english) throw new Error('English locale section is unavailable');
		if (normalized === 'en-US') {
			cacheLocaleSection(store, normalized, english);
			return english;
		}
		try {
			const localized = await fetchSection(normalized);
			const decoded = { ...english, ...decodeLocaleSection(localized, english) };
			cacheLocaleSection(store, normalized, decoded);
			return decoded;
		} catch {
			// A localized asset failure is readable through the English baseline, but
			// remains retryable on the next projection instead of permanent truth.
			cacheLocaleSection(store, normalized, english);
			store.fallbacks.add(normalized);
			return english;
		}
	})();
	store.loads.set(normalized, load);
	try {
		return await load;
	} finally {
		store.loads.delete(normalized);
	}
}
