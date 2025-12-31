// goal: Lorem Ipsum type definitions

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';

export interface LoremConfig {
	unit: LoremUnit;
	count: number;
	startWithLorem: boolean;
}
