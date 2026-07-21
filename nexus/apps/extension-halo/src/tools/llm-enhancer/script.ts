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
const _ICONS = {
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
				if (prefs?.['llm-enhancer']) {
					config.enabled = !!prefs['llm-enhancer'].enabled;
				}

				resolve();
			});
		} catch (_e) { resolve(); }
	});
}

function saveConfig() {
	// We only save transient states (like Widescreen toggles) here if we want them persisted.
	// Ideally, sidepanel updates this, and we listen to changes.
	const updates: Record<string, any> = {};
	updates[STORAGE_KEY] = config;
	chrome.storage.local.set(updates).catch((e) => console.warn('llm-enhancer persist failed', e));
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
			if (newPrefs?.['llm-enhancer']) {
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
	},

	injectGlobalStyles() {
		const css = `
        :root { 
            --halo-primary: #10a37f; 
            --halo-z: 2147483647; 
            --halo-llm-width: 1000px;
        }

        /* ====== 1. 滚动条美化 (Overlay 风格) ====== */
        ::-webkit-scrollbar { width: 10px !important; height: 10px !important; }
        ::-webkit-scrollbar-track { background: transparent !important; }
        ::-webkit-scrollbar-thumb { 
            background-color: rgba(0, 0, 0, 0.15) !important; 
            border-radius: 5px !important; 
            border: 3px solid transparent !important; 
            background-clip: content-box !important; 
        }
        ::-webkit-scrollbar-thumb:hover { background-color: rgba(0, 0, 0, 0.4) !important; }

        /* ====== 2. 基础环境锁定 ====== */
        body[data-halo-wide="true"], 
        body[data-halo-wide="true"] html {
            overflow: hidden !important; /* 禁掉外层滚动，防双滚动条 */
            height: 100vh !important;
        }

        /* ====== 3. 容器布局 (基于你找到的选择器) ====== */
        
        /* [外层容器]：负责显示滚动条，必须全屏宽 */
        body[data-halo-wide="true"] #chat-history,
        body[data-halo-wide="true"] #chat-history > infinite-scroller {
            width: 100% !important;
            max-width: 100% !important;
            height: 100vh !important;
            overflow-y: auto !important; /* 开启滚动 */
            scrollbar-gutter: stable !important; /* 防抖动 */
            
            /* 关键布局：让它成为垂直居中的指挥官 */
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important; /* 让所有子元素（消息气泡）水平居中 */
            padding: 0 !important;
        }

        /* [内层子元素]：真正的消息气泡，响应滑块宽度 */
        /* 使用 > * 选中 infinite-scroller 下的所有直接子节点 */
        body[data-halo-wide="true"] #chat-history > infinite-scroller > * {
            max-width: var(--halo-llm-width) !important; /* 响应滑块 */
            width: 100% !important;
            
            /* 双重保险居中 (防止 flex 失效时的 fallback) */
            margin-left: auto !important;
            margin-right: auto !important;
            
            /* 防止被压缩 */
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
        }

        /* ====== 4. 底部输入框修复 ====== */
        body[data-halo-wide="true"] .input-area,
        body[data-halo-wide="true"] footer,
        body[data-halo-wide="true"] .chat-input-container {
             max-width: var(--halo-llm-width) !important;
             margin-left: auto !important;
             margin-right: auto !important;
        }
        
        /* 隐藏占位符 spacer，防止布局跑偏 */
        body[data-halo-wide="true"] .spacer { display: none !important; }
        `;

		const oldStyle = document.getElementById('halo-llm-css');
		if (oldStyle) oldStyle.remove();

		const style = document.createElement('style');
		style.id = 'halo-llm-css';
		style.textContent = css;
		document.head.appendChild(style);
	},
};

// ====== Actions ======
const Actions = {
	setConfig(key: string, val: any) { config[key] = val; saveConfig(); },
	toggleWide() { config.widescreen = !config.widescreen; saveConfig(); },
	adjustWidth(delta: number) {
		let newWidth = (config.widthPercent || 100) + delta;
		if (newWidth < 50) newWidth = 50;
		if (newWidth > 150) newWidth = 150;
		config.widthPercent = newWidth;
		saveConfig();
		Actions.apply();
	},
	apply() {
		const isWide = config.widescreen;
		if (isWide) {
			document.body.setAttribute('data-halo-wide', 'true');

			// Base: 1000px. Scale: 50% (500px) to 150% (1500px)
			const percent = config.widthPercent || 100;
			const pxValue = 1000 * (percent / 100);
			document.documentElement.style.setProperty('--halo-llm-width', `${pxValue}px`);
			console.log(LOG_TAG, `Widescreen Applied: ${percent}% -> ${pxValue}px`);
		} else {
			document.body.removeAttribute('data-halo-wide');
		}

		// 3. Timeline Visibility (Global + Site-specific Config)
		// Logic: Enabled if (Global Enabled) AND (Timeline Master) AND (Site Specific !== false)
		// We default site specific to true if undefined
		// @ts-expect-error
		if (window.haloTimelineManager) {
			let siteEnabled = true;
			if (currentSite) {
				const settingKey = `timeline_${currentSite}`;
				if (config[settingKey] === false) siteEnabled = false;
			}

			const shouldShow = config.enabled && config.timeline && siteEnabled;
			try {
				// @ts-expect-error
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
		// @ts-expect-error
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
		} catch (_e) {
			// Ignore definition errors, likely already defined
			Actions.apply();
		}

		try {
			const url = chrome.runtime.getURL(`tools/llm-enhancer/timeline/${siteFiles[currentSite]}`);
			console.log(LOG_TAG, 'Importing timeline script:', url);
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
