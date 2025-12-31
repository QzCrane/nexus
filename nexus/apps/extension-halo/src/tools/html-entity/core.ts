// goal: HTML Entity core logic - encode and decode HTML entities

// Named entities map (common ones)
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

// Reverse map for decoding
const REVERSE_ENTITIES: Record<string, string> = Object.fromEntries(
	Object.entries(NAMED_ENTITIES).map(([k, v]) => [v, k])
);

// Encode special HTML characters (safe for HTML)
export function encodeHtmlSpecial(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Encode all characters to numeric entities
export function encodeHtmlAll(text: string): string {
	return Array.from(text)
		.map((char) => {
			const code = char.charCodeAt(0);
			if (code > 127 || '<>&"\''.includes(char)) {
				return `&#${code};`;
			}
			return char;
		})
		.join('');
}

// Encode to named entities where possible
export function encodeHtmlNamed(text: string): string {
	return Array.from(text)
		.map((char) => NAMED_ENTITIES[char] || char)
		.join('');
}

// Decode HTML entities
export function decodeHtml(text: string): string {
	// Decode named entities
	let result = text;
	for (const [entity, char] of Object.entries(REVERSE_ENTITIES)) {
		result = result.split(entity).join(char);
	}
	
	// Decode numeric entities (decimal)
	result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
	
	// Decode numeric entities (hex)
	result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
	
	return result;
}

// Get entity reference table for display
export function getEntityTable(): Array<{ char: string; entity: string; code: string }> {
	return Object.entries(NAMED_ENTITIES).map(([char, entity]) => ({
		char,
		entity,
		code: `&#${char.charCodeAt(0)};`,
	}));
}
