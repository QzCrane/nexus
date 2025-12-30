// goal: Base64 tool type definitions

export type Base64Mode = 'encode' | 'decode';

export interface Base64State {
	mode: Base64Mode;
	input: string;
	output: string;
	urlSafe: boolean;
	error: string | null;
}
