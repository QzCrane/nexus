// goal: URL tool type definitions

export type URLMode = 'encode' | 'decode' | 'parse';

export interface URLState {
	mode: URLMode;
	input: string;
	output: string;
	error: string | null;
}
