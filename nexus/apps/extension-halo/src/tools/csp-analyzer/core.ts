// goal: CSP Analyzer core logic

export interface CspDirective {
	name: string;
	values: string[];
	isUnsafe?: boolean;
	description?: string;
}

// Security risk dictionary
const UNSAFE_KEYWORDS = new Set([
	"'unsafe-inline'",
	"'unsafe-eval'",
	'*',
	'http:',
	'data:',
]);

const DIRECTIVE_DESCRIPTIONS: Record<string, string> = {
	"default-src": "Fallback for other fetch directives",
	"script-src": "Valid sources for JavaScript",
	"style-src": "Valid sources for stylesheets",
	"img-src": "Valid sources for images",
	"connect-src": "Valid sources for fetch/XHR/WebSocket",
	"font-src": "Valid sources for fonts",
	"object-src": "Valid sources for plugins (Flash, etc.)",
	"media-src": "Valid sources for audio/video",
	"frame-src": "Valid sources for frames/iframes",
	"report-uri": "URL to report violations (Deprecated, use report-to)",
};

// Parse CSP String
export function parseCsp(csp: string): CspDirective[] {
	if (!csp.trim()) return [];

	const directives: CspDirective[] = [];
	const parts = csp.split(';').map(p => p.trim()).filter(p => p);

	for (const part of parts) {
		const [name, ...values] = part.split(/\s+/);
		if (!name) continue;

		const riskFound = values.some(
			(value) => UNSAFE_KEYWORDS.has(value) || value.startsWith('*'),
		);

		directives.push({
			name,
			values,
			isUnsafe: riskFound,
			description: DIRECTIVE_DESCRIPTIONS[name] || `Controls ${name}`,
		});
	}

	return directives;
}

// Generate score? Simple one.
export function calculateScore(directives: CspDirective[]): number {
	let score = 100;
	directives.forEach(d => {
		if (d.values.includes("'unsafe-inline'")) score -= 20;
		if (d.values.includes("'unsafe-eval'")) score -= 20;
		if (d.values.includes("*")) score -= 10;
		if (d.values.includes("http:")) score -= 10;
		if (d.name === 'default-src' && d.values.includes("*")) score -= 10;
	});
	return Math.max(0, score);
}
