// goal: YAML tool type definitions

export type YamlMode = 'yaml-to-json' | 'json-to-yaml';

export interface YamlConvertResult {
	success: boolean;
	output: string;
	error?: string;
	normalizedInput?: string;
}
