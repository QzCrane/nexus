// goal: i18n type definitions (aggregated)
// eff: Type-safe translation keys composed of smaller interfaces

import { BaseTranslations, SettingsTranslations, ModuleTranslations } from './types-defs-1';

export type Locale = 'en' | 'zh';
export type ToolCategory = 'general' | 'dev' | 'efficiency' | 'visual' | 'ai' | 'security' | 'media' | 'browser' | 'active';

// Translation keys structure
export interface TranslationKeys extends
	BaseTranslations,
	SettingsTranslations,
	ModuleTranslations {
	[key: string]: any;
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
