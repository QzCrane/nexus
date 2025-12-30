// goal: Detailed translation interface definitions part 4
// eff: Split from main types.ts to reduce file size

export interface PanelsExtraTranslations {
	smoothScroll: {
		enable: string;
		enableDesc: string;
		behavior: string;
		stepSize: string;
		stepSizeDesc: string;
		animationTime: string;
		animationTimeDesc: string;
		accelerationMax: string;
		accelerationDelta: string;
		pulseScale: string;
		arrowKeyStep: string;
		easing: string;
		inputSources: string;
		mouseWheel: string;
		keyboard: string;
		touchpad: string;
		features: string;
		middleClickAutoScroll: string;
		fixedBackground: string;
		profiles: string;
		loadProfile: string;
		configMgmt: string;
		export: string;
		import: string;
		reset: string;
		saveCustom: string;
		profilesList: {
			default: string;
			iPhone: string;
			opera: string;
			ie: string;
			custom: string;
		};
		easingOptions: {
			linear: string;
			ease: string;
			easeOut: string;
			spring: string;
		};
		toasts: {
			loaded: string;
			savedCustom: string;
			exported: string;
			imported: string;
			importFailed: string;
			reset: string;
		};
	};
	tabsPanel: {
		searchPlaceholder: string;
		close: string;
		refresh: string;
		noTabs: string;
		pinned: string;
		audible: string;
		filterAll: string;
		filterAudible: string;
		filterPinned: string;
	};
	screenshotPanel: {
		captureVisible: string;
		capturing: string;
		copy: string;
		save: string;
		copied: string;
		downloaded: string;
	};
	pdfPanel: {
		dropHint: string;
		clickToSelect: string;
		files: string;
		pages: string;
		operation: string;
		process: string;
		ready: string;
		localOnly: string;
		config: string;
		splitRanges: string;
		extractPages: string;
		rotateAngle: string;
		watermarkText: string;
		watermarkOpacity: string;
		pageSize: string;
		fitImage: string;
		A4: string;
		Letter: string;
		ops: {
			merge: string;
			split: string;
			extract: string;
			rotate: string;
			watermark: string;
			imagesToPDF: string;
		};
		buttons: {
			download: string;
			processing: string;
		};
	};
	moduleStorePanel: {
		title: string;
		installed: string;
		available: string;
		updates: string;
		all: string;
		checkUpdates: string;
		update: string;
		noModules: string;
		allInstalled: string;
		core: string;
		new: string;
		builtIn: string;
		installing: string;
		updating: string;
		install: string;
		uninstall: string;
		loading: string;
	};
}
