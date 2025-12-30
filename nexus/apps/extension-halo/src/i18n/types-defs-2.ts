// goal: Detailed translation interface definitions part 2
// eff: Split from main types.ts to reduce file size

export interface PanelsCoreTranslations {
	qrcodePanel: {
		placeholder: string;
		generate: string;
		generating: string;
		copy: string;
		save: string;
		copied: string;
		downloaded: string;
		failed: string;
		recent: string;
		scan: string;
		scanFromImage: string;
		scanFromClipboard: string;
		scanning: string;
		scanSuccess: string;
		scanFailed: string;
		detectedContent: string;
		openLink: string;
		copyText: string;
	};
	colorPanel: {
		pickFromPage: string;
		history: string;
		noHistory: string;
		copied: string;
	};
	rulerPanel: {
		start: string;
		cancel: string;
		measuring: string;
		result: string;
		width: string;
		height: string;
		diagonal: string;
		ready: string;
	};
	jsonPanel: {
		placeholder: string;
		format: string;
		minify: string;
		sortKeys: string;
		copy: string;
		clear: string;
		invalidJson: string;
		formatted: string;
		minified: string;
		copied: string;
	};
	outlinePanel: {
		noHeadings: string;
		exportMd: string;
		refresh: string;
		jumpTo: string;
		exported: string;
	};
	clipboardPanel: {
		searchPlaceholder: string;
		clearUnpinned: string;
		empty: string;
		noMatch: string;
		pin: string;
		unpin: string;
		delete: string;
		copy: string;
		copied: string;
		unknownSource: string;
		pinned: string;
		confirmClear: string;
	};
}
