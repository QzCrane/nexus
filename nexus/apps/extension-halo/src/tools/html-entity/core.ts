// goal: HTML Entity adapter over the maintained `entities` engine (R14)
// rule: entity tables, named/numeric decoding and astral (non-BMP) code point
// handling belong to the engine — the hand-rolled map produced UTF-16 surrogate
// halves for non-BMP characters. The adapter keeps the tool's three encoding
// modes and its reference table display.

import { decodeHTML, encodeHTML, encodeNonAsciiHTML, escapeUTF8 } from 'entities';

// Named entities shown in the reference table (display policy stays local)
const NAMED_ENTITIES: Record<string, string> = {
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	'©': '&copy;', '®': '&reg;', '™': '&trade;', '€': '&euro;', '£': '&pound;',
	'¥': '&yen;', '¢': '&cent;', '§': '&sect;', '°': '&deg;', '±': '&plusmn;',
	'×': '&times;', '÷': '&divide;', '≠': '&ne;', '≤': '&le;', '≥': '&ge;',
	'←': '&larr;', '→': '&rarr;', '↑': '&uarr;', '↓': '&darr;', '↔': '&harr;',
	'∞': '&infin;', '√': '&radic;', '∑': '&sum;', '∏': '&prod;', '∫': '&int;',
	' ': '&nbsp;', '—': '&mdash;', '–': '&ndash;', '…': '&hellip;',
	'á': '&aacute;', 'é': '&eacute;', 'í': '&iacute;', 'ó': '&oacute;', 'ú': '&uacute;',
	'ñ': '&ntilde;', 'ü': '&uuml;', 'ç': '&ccedil;',
};

// Encode special HTML characters (safe for HTML)
export function encodeHtmlSpecial(text: string): string {
	return escapeUTF8(text);
}

// Encode all characters to numeric entities
export function encodeHtmlAll(text: string): string {
	return encodeNonAsciiHTML(text);
}

// Encode to named entities where possible
export function encodeHtmlNamed(text: string): string {
	return encodeHTML(text);
}

// Decode HTML entities (named, decimal and hex, astral-safe)
export function decodeHtml(text: string): string {
	return decodeHTML(text);
}

// Get entity reference table for display
export function getEntityTable(): Array<{ char: string; entity: string; code: string }> {
	return Object.entries(NAMED_ENTITIES).map(([char, entity]) => ({
		char,
		entity,
		code: `&#${char.codePointAt(0)};`,
	}));
}
