// goal: Color Picker tool type definitions

export interface RGBColor {
	r: number;
	g: number;
	b: number;
}

export interface HSLColor {
	h: number;
	s: number;
	l: number;
}

export interface ColorInfo {
	hex: string;
	rgb: RGBColor;
	hsl: HSLColor;
}

export interface ColorState {
	current: ColorInfo | null;
	history: string[]; // hex values
}

export const STORAGE_KEY = 'HALO_COLOR_HISTORY';
export const MAX_HISTORY = 20;
