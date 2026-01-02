// goal: i18n type definitions (aggregated)
// eff: Type-safe translation keys composed of smaller interfaces

import { BaseTranslations, SettingsTranslations, ModuleTranslations } from './types-defs-1';
import { PanelsCoreTranslations } from './types-defs-2';
import { PanelsDevTranslations } from './types-defs-3';
import { PanelsExtraTranslations } from './types-defs-4';

export type Locale = 'en' | 'zh';
export type ToolCategory = 'general' | 'dev' | 'efficiency' | 'visual' | 'ai' | 'security' | 'media' | 'browser' | 'pro';

// Translation keys structure
export interface TranslationKeys extends
	BaseTranslations,
	SettingsTranslations,
	ModuleTranslations,
	PanelsCoreTranslations,
	PanelsDevTranslations,
	PanelsExtraTranslations {
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
	| `regex.${keyof TranslationKeys['regex']}`
	| `base64.${keyof TranslationKeys['base64']}`
	| `hash.${keyof TranslationKeys['hash']}`
	| `uuid.${keyof TranslationKeys['uuid']}`
	| `timestamp.${keyof TranslationKeys['timestamp']}`
	| `url.${keyof TranslationKeys['url']}`
	| `tabsPanel.${keyof TranslationKeys['tabsPanel']}`
	| `screenshotPanel.${keyof TranslationKeys['screenshotPanel']}`
	| `moduleStorePanel.${keyof TranslationKeys['moduleStorePanel']}`
	| `pdfPanel.${keyof TranslationKeys['pdfPanel']}`;
