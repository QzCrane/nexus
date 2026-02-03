const LOG_TAG = '[HALO:LLM]';
const STORAGE_KEY = 'tool.llm-enhancer.config';
const TOOL_PREFS_KEY = 'halo_tool_prefs';

interface Config {
	enabled: boolean;
	widescreen: boolean;
	timeline: boolean;
	widthPercent: number;
	keepAlive: boolean;
	[key: string]: boolean | number | string | undefined; // For dynamic site keys
}

// ====== Icons ======
const ICONS = {
	LOGO: { viewBox: '0 0 24 24', paths: ['M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'] },
	ARROW_UP: { viewBox: '0 0 24 24', paths: ['M18 15l-6-6-6 6'] },
	WIDE: { viewBox: '0 0 24 24', shapes: [{ tag: 'rect', attrs: { x: 2, y: 3, width: 20, height: 14, rx: 2, ry: 2 } }, { tag: 'line', attrs: { x1: 8, y1: 21, x2: 16, y2: 21 } }, { tag: 'line', attrs: { x1: 12, y1: 17, x2: 12, y2: 21 } }] },
	CLOSE: { viewBox: '0 0 24 24', shapes: [{ tag: 'line', attrs: { x1: 18, y1: 6, x2: 6, y2: 18 } }, { tag: 'line', attrs: { x1: 6, y1: 6, x2: 18, y2: 18 } }] }
};

// ====== Configuration ======
const DEFAULT_CONFIG: Config = {
	enabled: true,
	widescreen: true,
	timeline: true,       // Master switch for timeline
	widthPercent: 100,    // Default to 100% as requested
	keepAlive: true,

	// Site-specific timeline toggles
	'timeline_chatgpt': true,
	'timeline_deepseek': true,
	'timeline_gemini': true,
};

let config: Config = { ...DEFAULT_CONFIG };
// Deprecated timelineManager removed

type SiteType = 'chatgpt' | 'deepseek' | 'gemini' | 'claude' | null;
let currentSite: SiteType = null;

// Config loader (ASYNC)
async function loadConfig(): Promise<void> {
	return new Promise((resolve) => {
		try {
			chrome.storage.local.get([STORAGE_KEY, TOOL_PREFS_KEY], (res) => {
				// 1. Load Internal Config
				const saved = res[STORAGE_KEY];
				if (saved) {
					config = { ...DEFAULT_CONFIG, ...saved };
				}

				// 2. Load Global Enabled State (Override)
				const prefs = res[TOOL_PREFS_KEY];
				if (prefs && prefs['llm-enhancer']) {
					config.enabled = !!prefs['llm-enhancer'].enabled;
				}

				resolve();
			});
		} catch (e) { resolve(); }
	});
}

function saveConfig() {
	// We only save transient states (like Widescreen toggles) here if we want them persisted.
	// Ideally, sidepanel updates this, and we listen to changes.
	const updates: Record<string, any> = {};
	updates[STORAGE_KEY] = config;
	chrome.storage.local.set(updates);
	Actions.apply(); // Ensure apply is called to update CSS variables immediately
}

// Listen for config changes from Sidepanel
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local') {
		let needApply = false;

		// Internal Config Change
		if (changes[STORAGE_KEY]) {
			config = { ...config, ...changes[STORAGE_KEY].newValue };
			needApply = true;
		}

		// Global Prefs Change
		if (changes[TOOL_PREFS_KEY]) {
			const newPrefs = changes[TOOL_PREFS_KEY].newValue;
			if (newPrefs && newPrefs['llm-enhancer']) {
				const newEnabled = !!newPrefs['llm-enhancer'].enabled;
				if (config.enabled !== newEnabled) {
					config.enabled = newEnabled;
					needApply = true;
				}
			}
		}

		if (needApply) Actions.apply();
	}
});

// ====== Site Detection ======
function detectSite(): SiteType {
	const h = location.hostname;
	if (h.includes('chatgpt') || h.includes('openai')) return 'chatgpt';
	if (h.includes('deepseek')) return 'deepseek';
	if (h.includes('gemini') || h.includes('aistudio')) return 'gemini';
	if (h.includes('claude')) return 'claude';
	return null;
}

// ====== UI / Dock ======
const UI = {
	init() {
		this.injectGlobalStyles();
		this.bindShortcuts();
	},

	injectGlobalStyles() {
		const css = `
        :root { --halo-primary: #10a37f; --halo-z: 2147483647; }
        
        /* Widescreen tokens */
        
        /* 1. SCROLLBAR FIX: Force the primary scroll container to span the entire viewport width */
        /* This pushes the native scrollbar to the far right edge of the screen */
        body[data-halo-wide="true"] main,
        body[data-halo-wide="true"] .infinite-scroller, 
        body[data-halo-wide="true"] .conversation-container,
        body[data-halo-wide="true"] [data-test-id="chat-history-container"], /* Gemini specific */
        body[data-halo-wide="true"] .scroller-v2 {
            width: 100vw !important; /* Viewport Width is safer than % for scrollbar push */
            max-width: 100vw !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
            overflow-y: auto !important;
            position: relative; /* Ensure it respects flow but takes space */
            left: 0 !important;
            right: 0 !important;
        }
        
        /* Ensure the main chat wrapper doesn't constrain it */
        body[data-halo-wide="true"] .chat-app, 
        body[data-halo-wide="true"] .chat-history {
            width: 100% !important;
            max-width: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important; /* Centering helper */
        }

        /* 2. THE GOLDEN COLUMN: The actual text content container */
        /* Controlled by var(--halo-llm-width) which is adjusted via Alt + Left/Right */
        body[data-halo-wide="true"] ms-message-list,
        body[data-halo-wide="true"] ms-message-list > div,
        body[data-halo-wide="true"] .conversation-container > div, /* Inner wrapper */
        body[data-halo-wide="true"] .input-area-container,
        body[data-halo-wide="true"] .bottom-container,
        body[data-halo-wide="true"] .chat-container,
        body[data-halo-wide="true"] .ds-chat-width { 
            max-width: var(--halo-llm-width) !important;
            width: 100% !important;
            margin-left: auto !important;
            margin-right: auto !important;
            padding-left: 2rem !important; /* Add breathing room since it's full width */
            padding-right: 2rem !important;
        }

        /* 3. MESSAGE LAYOUT & OVERLAP FIX */
        body[data-halo-wide="true"] model-response,
        body[data-halo-wide="true"] user-query,
        body[data-halo-wide="true"] .model-response-container,
        body[data-halo-wide="true"] .user-query-container {
            max-width: 100% !important;
            width: 100% !important;
            margin-bottom: 2rem !important; /* Fix overlap by forcing gap */
            display: block !important;      /* Ensure they don't collapse */
            min-height: auto !important;    /* Let content dictate height */
        }

        /* 3. MESSAGE LAYOUT: Remove internal width limits (e.g. 48rem) and fix drift */
        body[data-halo-wide="true"] model-response,
        body[data-halo-wide="true"] user-query,
        body[data-halo-wide="true"] .model-response-container,
        body[data-halo-wide="true"] .user-query-container {
            max-width: 100% !important;
            width: 100% !important;
        }

        /* Lock AI Content to Left (next to icon) */
        body[data-halo-wide="true"] model-response > div,
        body[data-halo-wide="true"] .model-response-container > div {
            display: flex !important;
            justify-content: flex-start !important;
        }

        body[data-halo-wide="true"] model-response .response-container-content,
        body[data-halo-wide="true"] model-response [class*="content"] {
            margin-left: 0 !important;
            max-width: 100% !important;
            flex: 1 !important;
        }

        /* Lock User Content to Right */
        body[data-halo-wide="true"] user-query > div {
            display: flex !important;
            justify-content: flex-end !important;
        }

        /* 4. GEMINI INTERNAL VARIABLES: Override the hardcoded limits in their system */
        body[data-halo-wide="true"] {
            --chat-content-width-max: 100% !important;
            --gemini-chat-width-max: 100% !important;
            --message-list-width-max: 100% !important;
        }
        `;
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	},

	bindShortcuts() {
		window.addEventListener('keydown', (e) => {
			if (!config.enabled) return;
			if (e.altKey) {
				// Timeline Nav
				// @ts-ignore
				if (e.key === 'ArrowUp') { e.preventDefault(); window.haloTimelineManager?.nav(-1); }
				// @ts-ignore
				if (e.key === 'ArrowDown') { e.preventDefault(); window.haloTimelineManager?.nav(1); }

				// Width Adjustment (Alt + Left / Alt + Right)
				if (e.key === 'ArrowLeft') {
					e.preventDefault();
					Actions.adjustWidth(-5);
				}
				if (e.key === 'ArrowRight') {
					e.preventDefault();
					Actions.adjustWidth(5);
				}

				// Toggle Wide Mode
				if (e.code === 'KeyW') { e.preventDefault(); Actions.toggleWide(); }
			}
		});
	}
};

// ====== Actions ======
const Actions = {
	setConfig(key: string, val: any) { config[key] = val; saveConfig(); },
	toggleWide() { config.widescreen = !config.widescreen; saveConfig(); },
	adjustWidth(delta: number) {
		let newWidth = (config.widthPercent || 100) + delta;
		if (newWidth < 50) newWidth = 50;   // Min scale 50%
		if (newWidth > 200) newWidth = 200; // Max scale 200%
		config.widthPercent = newWidth;
		saveConfig();
		Actions.apply();
	},
	apply() {
		// 1. Widescreen
		const isWide = config.widescreen;
		if (isWide) {
			document.body.setAttribute('data-halo-wide', 'true');

			// LOGIC: 100% = Native Layout (~48rem).
			// Range: 50% (24rem) to 200% (96rem).
			const percent = config.widthPercent || 100;
			// We inject the raw percentage into CSS to let calc handle it, or pre-calc it.
			// Pre-calc is safer: 48rem * (percent / 100)
			const remValue = 48 * (percent / 100);
			document.documentElement.style.setProperty('--halo-llm-width', `${remValue}rem`);
		} else {
			document.body.removeAttribute('data-halo-wide');
		}

		// 3. Timeline Visibility (Global + Site-specific Config)
		// Logic: Enabled if (Global Enabled) AND (Timeline Master) AND (Site Specific !== false)
		// We default site specific to true if undefined
		// @ts-ignore
		if (window.haloTimelineManager) {
			let siteEnabled = true;
			if (currentSite) {
				const settingKey = `timeline_${currentSite}`;
				if (config[settingKey] === false) siteEnabled = false;
			}

			const shouldShow = config.enabled && config.timeline && siteEnabled;
			try {
				// @ts-ignore
				window.haloTimelineManager.setVisible(shouldShow);
			} catch (e) {
				console.warn(LOG_TAG, 'Failed to set timeline visibility:', e);
			}
		}
	}
};

// ====== Main Initializer ======
async function main() {
	currentSite = detectSite();
	if (!currentSite) return;

	await loadConfig(); // Wait for config

	UI.init();

	// Inject Styles based on site (via CSS file injection)
	const cssFile = `tools/llm-enhancer/timeline/styles-${currentSite}.css`;
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = chrome.runtime.getURL(cssFile);
	document.head.appendChild(link);

	Actions.apply();

	// Load specific content logic (side-effect imports)
	console.log(LOG_TAG, 'Detected site:', currentSite);

	const siteFiles: Record<string, string | null> = {
		'chatgpt': 'content-chatgpt.js',
		'deepseek': 'content-deepseek.js',
		'gemini': 'content-gemini.js',
		'claude': null // Not yet implemented
	};

	if (currentSite && siteFiles[currentSite]) {
		// New Event-based Mechanism
		window.addEventListener('halo-timeline-ready', () => {
			console.log(LOG_TAG, 'Timeline Ready Event received. Applying config...');
			Actions.apply();
		});

		// Robust Shim for Manager (Backward Compatibility & fallback)
		// We still use this because 'halo-timeline-ready' might have fired before we attached listener
		// @ts-ignore
		let _haloTimelineManager = window.haloTimelineManager || null;
		if (_haloTimelineManager) {
			setTimeout(() => Actions.apply(), 50);
		}

		try {
			Object.defineProperty(window, 'haloTimelineManager', {
				get() { return _haloTimelineManager; },
				set(val) {
					_haloTimelineManager = val;
					if (val) {
						// Fallback: if event missed or not sent
						console.log(LOG_TAG, 'Timeline Manager initialized (setter). Apply config soon...');
						setTimeout(() => Actions.apply(), 100);
					}
				},
				configurable: true
			});
		} catch (e) {
			// Ignore definition errors, likely already defined
			Actions.apply();
		}

		try {
			const url = chrome.runtime.getURL(`tools/llm-enhancer/timeline/${siteFiles[currentSite]}`);
			console.log(LOG_TAG, 'Importing timeline script:', url);
			// @ts-ignore
			await import(url);
			console.log(LOG_TAG, 'Timeline script imported successfully');
		} catch (e) {
			console.error(LOG_TAG, 'Failed to load timeline script:', e);
		}
	}

	// Keep Alive
	setInterval(() => {
		if (config.enabled && config.keepAlive) {
			const b = document.querySelector('.btn-continue, [aria-label*="Continue"]') as HTMLElement;
			if (b) b.click();
		}
	}, 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
