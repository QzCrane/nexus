// goal: i18n type definitions (aggregated)
// eff: Type-safe translation keys composed of smaller interfaces

import type { BaseTranslations, SettingsTranslations, ModuleTranslations } from './types-defs-1';

export type Locale = 'en' | 'zh';
export type LocaleSetting = Locale | 'system';
export type TranslationParams = Record<string, unknown>;
export type TranslationOptions = TranslationParams & {
	defaultValue?: string;
};
export type TranslationFunction = (
	path: string,
	options?: TranslationOptions
) => string;
// 'active' is a virtual runtime category, 'system' is for internal filtering only
// Refined developer categories: encode, format, network, data, dev
// 'scripts' is aggregation view for all script plugins
export type ToolCategory =
	| 'general' | 'encode' | 'format' | 'network' | 'data' | 'dev'
	| 'efficiency' | 'browser' | 'visual' | 'media' | 'security' | 'ai'
	| 'active' | 'scripts' | 'system';

// Translation keys structure
export interface TranslationKeys extends
	BaseTranslations,
	SettingsTranslations,
	ModuleTranslations {
	[key: string]: unknown;
}

export type TranslationPath =
	| `common.${keyof TranslationKeys['common']}`
	| `categories.${ToolCategory}`
	| `tools.${string}.name`
	| `tools.${string}.desc`
	| `settings.${keyof TranslationKeys['settings']}`
	| `toolManager.${keyof TranslationKeys['toolManager']}`
	| `footer.${keyof TranslationKeys['footer']}`
	| string; // Allow any string for tool-specific keys
