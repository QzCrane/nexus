// goal: v0.6.0 tool translations (English)

export const panelsV6 = {
	textTools: {
		modes: { case: 'Case', stats: 'Stats', dedupe: 'Dedupe', sort: 'Sort' },
		placeholder: 'Enter or paste text here...',
		convert: 'Convert', dedupe: 'Remove Duplicates', trim: 'Trim Lines',
		sortAsc: 'Sort A-Z', sortDesc: 'Sort Z-A', reverse: 'Reverse',
		stats: { chars: 'Characters', charsNoSpaces: 'No Spaces', words: 'Words', lines: 'Lines', bytes: 'Bytes' },
	},
	loremIpsum: {
		generate: 'Generate', generateBtn: 'Generate', startWithLorem: 'Start with "Lorem ipsum"',
		units: { words: 'Words', sentences: 'Sentences', paragraphs: 'Paragraphs' },
	},
	diff: {
		original: 'Original', modified: 'Modified', compare: 'Compare',
		swap: 'Swap', clear: 'Clear', additions: 'additions', deletions: 'deletions',
		pasteOriginal: 'Paste original text...', pasteModified: 'Paste modified text...',
	},
	yaml: {
		convert: 'Convert', swap: 'Swap', pasteYaml: 'Paste YAML here...', pasteJson: 'Paste JSON here...',
	},
	numberBase: {
		input: 'Input', placeholder: 'Enter a number...', invalidInput: 'Invalid input for selected base',
	},
	markdown: {
		edit: 'Edit', split: 'Split', preview: 'Preview',
		placeholder: 'Write Markdown here...', copyMd: 'Copy MD', copyHtml: 'Copy HTML',
	},
	unitConverter: {
		from: 'From', to: 'To', swap: 'Swap',
	},
	cron: {
		minute: 'Minute', hour: 'Hour', dayOfMonth: 'Day', month: 'Month', dayOfWeek: 'Weekday',
		invalid: 'Invalid cron expression', presets: 'Presets', nextRuns: 'Next 5 Runs',
	},
	htmlEntity: {
		encode: 'Encode', decode: 'Decode', input: 'Input', output: 'Output',
		encodeSpecial: 'Special Only', encodeNamed: 'Named Entities', encodeAll: 'All Characters',
		decodeBtn: 'Decode', reference: 'Entity Reference',
	},
	codeFormatter: {
		placeholder: 'Paste code here...', indentSize: 'Indent Size',
		format: 'Format', minify: 'Minify',
	},
	passwordGen: {
		generate: 'Generate', length: 'Length', history: 'History',
		uppercase: 'Uppercase', lowercase: 'Lowercase', numbers: 'Numbers', symbols: 'Symbols',
		excludeAmbiguous: 'Exclude similar (0, O, l, 1)',
	},
	imageTools: {
		dropHint: 'Drop image or click to select', format: 'Format', quality: 'Quality',
		process: 'Compress/Convert', download: 'Download', saved: 'saved',
	},
	cookieManager: {
		title: 'Cookies', cookies: 'cookies', search: 'Search cookies...',
		loading: 'Loading...', noCookies: 'No cookies found',
	},
	readerMode: {
		extract: 'Extract Article', fontSize: 'Font Size', font: 'Font',
		clickToExtract: 'Click to extract article from current page',
	},
	totp: {
		addAccount: 'Add Account', cancel: 'Cancel', add: 'Add',
		name: 'Account Name', secretOrUri: 'Secret Key or otpauth:// URI',
		noAccounts: 'No 2FA accounts added',
	},
	bookmarkManager: {
		recent: 'Recent', search: 'Search', searchPlaceholder: 'Search bookmarks...',
		loading: 'Loading...', noResults: 'No bookmarks found', noRecent: 'No recent bookmarks',
	},
	techStack: {
		scan: 'Scan Page', detected: 'Technologies', categories: 'Categories',
		noTech: 'No technologies detected', clickToScan: 'Click to scan current page',
	},
	stickyNotes: {
		title: 'Sticky Notes', add: 'New Note', empty: 'Click + to add a note', placeholder: 'Write here...',
	},
	pomodoro: {
		sessions: 'Sessions', start: 'Start', pause: 'Pause',
		work: 'Work', shortBreak: 'Short', longBreak: 'Long',
	},
	timer: {
		stopwatch: 'Stopwatch', countdown: 'Countdown',
		start: 'Start', pause: 'Pause', lap: 'Lap',
	},
	httpStatus: {
		search: 'Search status codes...',
	},
	csvViewer: {
		placeholder: 'Paste CSV data here...', empty: 'Paste CSV to view as table',
		showing100: 'Showing first 100 rows',
	},
	shortcuts: {
		search: 'Search shortcuts...', noResults: 'No shortcuts found',
	},
	ipLookup: {
		placeholder: 'Enter IP address or leave empty for your IP',
		loading: 'Loading...', invalidIp: 'Invalid IP address', notFound: 'IP not found',
		location: 'Location', org: 'Organization', hostname: 'Hostname',
		timezone: 'Timezone', coords: 'Coordinates',
	},
	fontInspector: {
		scan: 'Scan Page Fonts', noFonts: 'No fonts detected', clickToScan: 'Click to scan page fonts',
	},
	xmlFormatter: {
		placeholder: 'Paste XML here...', format: 'Format', minify: 'Minify',
		valid: 'Valid', invalid: 'Invalid', elements: 'elements', attributes: 'attrs',
	},
	historySearch: {
		placeholder: 'Search history...', loading: 'Loading...', noResults: 'No history found',
	},
	headersViewer: {
		placeholder: 'Enter URL...', loading: 'Loading...', empty: 'Enter URL to view headers',
	},
	exifReader: {
		dropHere: 'Drop image here or click to select',
		noExif: 'No EXIF data found',
		make: 'Make', model: 'Model', dateTime: 'Date', software: 'Software',
		dimensions: 'Dimensions', fileSize: 'Size',
	},
	tableExtractor: {
		extract: 'Extract Tables', noTables: 'No tables found on page',
		clickToExtract: 'Click to extract tables from current page',
	},
	todoList: {
		placeholder: 'Add a new task...', empty: 'No tasks yet',
		all: 'All', active: 'Active', completed: 'Completed',
		remaining: 'remaining', clearCompleted: 'Clear completed',
	},
	storageEditor: {
		scan: 'Scan Storage', empty: 'No storage data', clickToScan: 'Click to scan page storage',
	},
	tts: {
		placeholder: 'Enter text to read aloud...', loadSelected: 'Load selected text',
		play: 'Play', voice: 'Voice', rate: 'Speed', pitch: 'Pitch',
	},
	userAgent: {
		current: 'Current User Agent',
	},
	colorPalette: {
		dropHere: 'Drop image here or click to select',
	},
	gzip: {
		compress: 'Compress', decompress: 'Decompress',
		input: 'Input', output: 'Output', inputText: 'Enter text to compress...',
		inputBase64: 'Enter Base64 gzip data...', saved: 'saved', error: 'Invalid input',
	},
	jwt: {
		placeholder: 'Paste JWT token here...', invalid: 'Invalid JWT token',
	},
	morse: {
		encode: 'Text → Morse', decode: 'Morse → Text',
		input: 'Input', output: 'Output', copy: 'Copy',
	},
	jsonToCsv: {
		input: 'JSON Input', output: 'CSV Output', delimiter: 'Delimiter', copy: 'Copy CSV', download: 'Download CSV',
	},
	sql: {
		format: 'Format', minify: 'Minify', copy: 'Copy',
	},
	jsonPath: {
		matches: 'matches', copy: 'Copy Result',
	},
	checksum: {
		dropFile: 'Drop file here to calculate hash', algorithm: 'Algorithm', expectedHash: 'Paste expected hash to verify...',
	},
	punycode: {
		input: 'Domain (Unicode / Punycode)', encode: 'Encode (to ASCII)', decode: 'Decode (to Unicode)',
	},
	rot13: {
		input: 'Input', output: 'Output', mode: 'Mode', shift: 'Shift',
	},
	csvToJson: {
		input: 'CSV Input', output: 'JSON Output', separator: 'Separator', header: 'Has Header',
	},
	hexDump: {
		drop: 'Drop file here to dump', offset: 'Offset', hex: 'Hex', ascii: 'ASCII',
	},
};
