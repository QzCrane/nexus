// goal: Code Formatter type definitions

export type CodeLanguage = 'html' | 'css' | 'js' | 'json' | 'sql' | 'xml';

export interface FormatConfig {
	language: CodeLanguage;
	indentSize: number;
	useTabs: boolean;
}
