// goal: Text Tools type definitions

export type CaseType = 'lower' | 'upper' | 'title' | 'sentence' | 'camel' | 'snake' | 'constant' | 'kebab';

export interface TextStats {
	chars: number;
	charsNoSpaces: number;
	words: number;
	lines: number;
	bytes: number;
}

export type TextToolMode = 'case' | 'stats' | 'dedupe' | 'sort';
