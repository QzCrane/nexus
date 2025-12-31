// goal: Number Base tool type definitions

export type Base = 2 | 8 | 10 | 16;

export interface BaseConvertResult {
	binary: string;
	octal: string;
	decimal: string;
	hex: string;
}
