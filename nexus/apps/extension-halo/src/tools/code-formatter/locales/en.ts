export const en = {
	'tools.code-formatter.name': 'Code Formatter',
	'tools.code-formatter.desc': 'Format or compact text with language-specific boundaries',
	codeFormatter: {
		placeholder: 'Paste code here...',
		indentSize: 'Indent Size',
		format: 'Format',
		minify: 'Minify',
		boundaries: {
			json: 'Strict JSON. Formatting and minification preserve the original number digits.',
			html: 'Whitespace indentation only; HTML syntax is not validated.',
			xml: 'Whitespace indentation only. Use XML Formatter when document-level XML fidelity is required.',
			css: 'Formatting is whitespace-based; minification uses CSSO and reports engine failures.',
			js: 'Basic indentation and comment/whitespace removal only; JavaScript syntax is not validated.',
			sql: 'Formatting uses sql-formatter; minification only removes comments and collapses whitespace outside strings.'
		}
	}
};
