// goal: Color Picker tool type definitions with CMYK and WCAG support

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

export interface CMYKColor {
	c: number;
	m: number;
	y: number;
	k: number;
}

export interface ColorInfo {
	hex: string;
	rgb: RGBColor;
	hsl: HSLColor;
	cmyk: CMYKColor;
}

// WCAG contrast result
export interface ContrastResult {
	ratio: number;
	ratingAA: 'pass' | 'fail';
	ratingAAA: 'pass' | 'fail';
	ratingAALarge: 'pass' | 'fail';
	ratingAAALarge: 'pass' | 'fail';
}

export interface ColorState {
	current: ColorInfo | null;
	compare: ColorInfo | null; // For contrast checking
	history: string[]; // hex values
}

export const STORAGE_KEY = 'HALO_COLOR_HISTORY';
export const MAX_HISTORY = 20;
