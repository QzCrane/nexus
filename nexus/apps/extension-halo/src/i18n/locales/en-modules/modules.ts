export const modules = {
	tools: {
		qrcode: {
			name: 'QR Code',
			desc: 'Generate QR codes with history & right-click integration',
		},
		'color-picker': {
			name: 'Color Picker',
			desc: 'Pick colors in HEX/RGB/HSL with history',
		},
		ruler: {
			name: 'Ruler',
			desc: 'Measure page elements in px/rem',
		},
		'json-formatter': {
			name: 'JSON',
			desc: 'Format, compress & sort JSON keys',
		},
		outline: {
			name: 'Outline',
			desc: 'Page headings with jump & markdown export',
		},
		clipboard: {
			name: 'Clipboard',
			desc: 'Smart clipboard with cross-page references',
		},
		pdf: {
			name: 'PDF Tools',
			desc: 'Merge, split & compress PDFs locally',
		},
		archive: {
			name: 'Archive',
			desc: 'Save complete web pages offline',
		},
		screenshot: {
			name: 'Screenshot',
			desc: 'Capture & annotate screenshots',
		},
		regex: {
			name: 'Regex',
			desc: 'Test regular expressions with live preview',
		},
		'base64': {
			name: 'Base64',
			desc: 'Encode & decode Base64 strings',
		},
		timer: {
			name: 'Timer',
			desc: 'Pomodoro timer & stopwatch',
		},
		notes: {
			name: 'Quick Notes',
			desc: 'Take quick notes anywhere',
		},
		hash: {
			name: 'Hash Generator',
			desc: 'Calculate MD5, SHA-1, SHA-256 & SHA-512',
		},
		uuid: {
			name: 'UUID Generator',
			desc: 'Generate UUID v4 identifiers',
		},
		timestamp: {
			name: 'Timestamp',
			desc: 'Convert & format timestamps/dates',
		},
		url: {
			name: 'URL Encoder',
			desc: 'Encode, decode & parse URLs',
		},
		settings: {
			name: 'Settings',
			desc: 'Customize HALO appearance & behavior',
		},
		'smooth-scroll': {
			name: 'Scroll',
			desc: 'Smooth scrolling for all pages',
		},
		tabs: {
			name: 'Tabs',
			desc: 'Vertical vertical tab manager',
		},
		'module-store': {
			name: 'Module Store',
			desc: 'Install or remove tool modules',
		},
		crypto: {
			name: 'Crypto Tools',
			desc: 'JWT, RSA, AES encryption',
		},
		network: {
			name: 'Network Utils',
			desc: 'UA Parser, Curl converter',
		},

		'mock-data': {
			name: 'Mock Data',
			desc: 'Generate test data',
		},
		userscripts: {
			name: 'UserScripts',
			desc: 'Inject custom JavaScript',
		},
		yaml: {
			name: 'YAML',
			desc: 'YAML <> JSON converter',
		},
		diff: {
			name: 'Diff',
			desc: 'Compare text differences',
		},
		'number-base': {
			name: 'Number Base',
			desc: 'Convert binary, hex, decimal',
		},
		'text-tools': {
			name: 'Text Tools',
			desc: 'Case, Sort, Dedupe text',
		},
		permissions: {
			name: 'Permissions',
			desc: 'Manage extension permissions',
		},
		'lorem-ipsum': {
			name: 'Lorem Ipsum',
			desc: 'Generate placeholder text',
		},
		// New translations v1.3+
		markdown: {
			name: 'Markdown',
			desc: 'Markdown editor & preview',
		},
		'unit-converter': {
			name: 'Unit Converter',
			desc: 'Convert length, weight, temp, data',
		},
		cron: {
			name: 'Cron Parser',
			desc: 'Parse and explain Cron expressions',
		},
		'html-entity': {
			name: 'HTML Entity',
			desc: 'Encode/Decode HTML entities',
		},
		'code-formatter': {
			name: 'Code Formatter',
			desc: 'Format and minify code',
		},
		'password-gen': {
			name: 'Password Gen',
			desc: 'Generate secure random passwords',
		},
		'image-tools': {
			name: 'Image Tools',
			desc: 'Compress and convert images',
		},
		'cookie-manager': {
			name: 'Cookie Manager',
			desc: 'View and edit site cookies',
		},
		'reader-mode': {
			name: 'Reader Mode',
			desc: 'Distraction-free reading',
		},
		totp: {
			name: 'TOTP Auth',
			desc: '2FA code generator',
		},
		'bookmark-manager': {
			name: 'Bookmarks',
			desc: 'Manage and search bookmarks',
		},
		'tech-stack': {
			name: 'Tech Stack',
			desc: 'Detect website technologies',
		},
		'sticky-notes': {
			name: 'Sticky Notes',
			desc: 'Quick notes and reminders',
		},
		pomodoro: {
			name: 'Pomodoro',
			desc: 'Focus timer with breaks',
		},
		'http-status': {
			name: 'HTTP Status',
			desc: 'HTTP status code reference',
		},
		'csv-viewer': {
			name: 'CSV Viewer',
			desc: 'Parse and view CSV data',
		},
		shortcuts: {
			name: 'Shortcuts',
			desc: 'Keyboard shortcuts reference',
		},
		'ip-lookup': {
			name: 'IP Lookup',
			desc: 'Query IP address info',
		},
		'font-inspector': {
			name: 'Font Inspector',
			desc: 'Identify page fonts',
		},
		'xml-formatter': {
			name: 'XML Formatter',
			desc: 'Format and validate XML',
		},
		'history-search': {
			name: 'History Search',
			desc: 'Search browsing history',
		},
		'headers-viewer': {
			name: 'Headers Viewer',
			desc: 'View HTTP headers',
		},
		'exif-reader': {
			name: 'EXIF Reader',
			desc: 'Read image metadata',
		},
		'table-extractor': {
			name: 'Table Extractor',
			desc: 'Extract tables to CSV',
		},
		'todo-list': {
			name: 'Todo List',
			desc: 'Simple task management',
		},
		'storage-editor': {
			name: 'Storage Editor',
			desc: 'Edit localStorage/sessionStorage',
		},
		'text-to-speech': {
			name: 'Text to Speech',
			desc: 'Read text aloud',
		},
		'user-agent': {
			name: 'User Agent',
			desc: 'UA string parser',
		},
		'color-palette': {
			name: 'Color Palette',
			desc: 'Extract colors from images',
		},
		gzip: {
			name: 'Gzip',
			desc: 'Gzip compression tool',
		},
		'jwt-decoder': {
			name: 'JWT Decoder',
			desc: 'Decode JWT tokens',
		},
		morse: {
			name: 'Morse Code',
			desc: 'Morse code encoder/decoder',
		},
		'emoji-picker': {
			name: 'Emoji Picker',
			desc: 'Browse and copy emojis',
		},
		'json-to-csv': {
			name: 'JSON to CSV',
			desc: 'Convert JSON data to CSV',
		},
		'sql-formatter': {
			name: 'SQL Formatter',
			desc: 'Format and beautify SQL',
		},
		'json-path': {
			name: 'JSONPath',
			desc: 'Query JSON data path',
		},
		checksum: {
			name: 'Checksum',
			desc: 'File hash verification',
		},
		punycode: {
			name: 'Punycode',
			desc: 'IDN domain converter',
		},
		rot13: {
			name: 'ROT13',
			desc: 'ROT13/ROT47 cipher',
		},
		'csv-to-json': {
			name: 'CSV to JSON',
			desc: 'Convert CSV data to JSON',
		},
		'hex-dump': {
			name: 'Hex Dump',
			desc: 'View file hex dump',
		},
		'ssl-cert': {
			name: 'SSL Certificate',
			desc: 'Parse SSL certificate info',
		},
		xor: {
			name: 'XOR',
			desc: 'XOR string calculator',
		},
		protobuf: {
			name: 'Protobuf',
			desc: 'Decode raw protobuf',
		},
		'random-gen': {
			name: 'Random Gen',
			desc: 'Generate UUIDs and Keys',
		},
		subresource: {
			name: 'SRI Gen',
			desc: 'Generate Subresource Integrity',
		},
		'csp-analyzer': {
			name: 'CSP Analyzer',
			desc: 'Analyze Content Security Policy',
		},
		'dom-selector': {
			name: 'DOM Selector',
			desc: 'Get CSS/XPath selectors',
		},
		'session-manager': {
			name: 'Session Manager',
			desc: 'Save and restore tabs',
		},
		'page-annotate': {
			name: 'Page Annotate',
			desc: 'Draw keynotes on webpage',
		},
		translate: {
			name: 'Translate',
			desc: 'Quick page translation',
		},
		'tab-group': {
			name: 'Tab Group',
			desc: 'Manage browser tab groups',
		},
	},
};
