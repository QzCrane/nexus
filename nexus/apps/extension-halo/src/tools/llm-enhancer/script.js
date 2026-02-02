const LOG_TAG = '[HALO:LLM]';
const STORAGE_KEY = 'tool.llm-enhancer.config';
const TOOL_PREFS_KEY = 'halo_tool_prefs';

// ====== Icons ======
const ICONS = {
	LOGO: { viewBox: '0 0 24 24', paths: ['M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'] },
	ARROW_UP: { viewBox: '0 0 24 24', paths: ['M18 15l-6-6-6 6'] },
	WIDE: { viewBox: '0 0 24 24', shapes: [{ tag: 'rect', attrs: { x: 2, y: 3, width: 20, height: 14, rx: 2, ry: 2 } }, { tag: 'line', attrs: { x1: 8, y1: 21, x2: 16, y2: 21 } }, { tag: 'line', attrs: { x1: 12, y1: 17, x2: 12, y2: 21 } }] },
	CLOSE: { viewBox: '0 0 24 24', shapes: [{ tag: 'line', attrs: { x1: 18, y1: 6, x2: 6, y2: 18 } }, { tag: 'line', attrs: { x1: 6, y1: 6, x2: 18, y2: 18 } }] }
};

// ====== Configuration ======
const DEFAULT_CONFIG = {
	enabled: true,
	widescreen: true,
	timeline: true,
	widthPercent: 90,
	keepAlive: true,
	// sites config is handled by granular storage or assumes all enabled if tool is active
};

let config = { ...DEFAULT_CONFIG };
let timelineManager = null;
let currentSite = null;

// Config loader (ASYNC)
async function loadConfig() {
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
	const updates = {};
	updates[STORAGE_KEY] = config;
	chrome.storage.local.set(updates);
	Actions.apply();
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
function detectSite() {
	const h = location.hostname;
	if (h.includes('chatgpt') || h.includes('openai')) return 'chatgpt';
	if (h.includes('deepseek')) return 'deepseek';
	if (h.includes('gemini') || h.includes('aistudio')) return 'gemini';
	if (h.includes('claude')) return 'claude';
	return null;
}

// ====== UI / Dock ======
const UI = {
	dock: null,

	init() {
		if (document.getElementById('halo-dock')) return;
		this.injectGlobalStyles();
		this.createDock();
		this.bindShortcuts();
	},

	injectGlobalStyles() {
		const css = `
        :root { --halo-primary: #10a37f; --halo-z: 2147483647; }
        .halo-dock-bar {
            display: flex; align-items: center; gap: 6px;
            background: rgba(30,30,30,0.85); backdrop-filter: blur(16px);
            border: 1px solid rgba(255,255,255,0.1); padding: 5px; border-radius: 100px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3); transition: 0.2s;
        }
        @media (prefers-color-scheme: light) {
            .halo-dock-bar { background: rgba(255,255,255,0.85); border-color: rgba(0,0,0,0.08); }
        }
        .halo-btn {
            width: 32px; height: 32px; border-radius: 50%; border: none;
            background: transparent; color: inherit; display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: 0.2s; position: relative;
        }
        .halo-btn:hover { background: rgba(128,128,128,0.15); }
        .halo-btn.active { color: var(--halo-primary); background: rgba(16, 163, 127, 0.1); }
        #halo-dock { position: fixed; bottom: 24px; right: 80px; z-index: var(--halo-z); display: none; }
        
        /* Widescreen tokens */
        body[data-halo-wide="true"] .text-base, 
        body[data-halo-wide="true"] .xl\\:max-w-3xl, 
        body[data-halo-wide="true"] .ds-chat-width, 
        body[data-halo-wide="true"] .ds-markdown-container,
        body[data-halo-wide="true"] .chat-container,
        body[data-halo-wide="true"] .conversation-container, 
        body[data-halo-wide="true"] .model-response-container,
        body[data-halo-wide="true"] .response-container-content,
        body[data-halo-wide="true"] .bottom-container,
        body[data-halo-wide="true"] .input-area-container,
        body[data-halo-wide="true"] .max-w-3xl, 
        body[data-halo-wide="true"] .max-w-2xl { 
            max-width: var(--halo-llm-width) !important; 
            margin-left: auto !important; margin-right: auto !important; 
        }
        `;
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	},

	createSvg(def, size = 18) {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', size); svg.setAttribute('height', size);
		svg.setAttribute('viewBox', def.viewBox); svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
		if (def.paths) def.paths.forEach(d => { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.appendChild(path); });
		if (def.shapes) def.shapes.forEach(s => { const el = document.createElementNS(ns, s.tag); Object.entries(s.attrs).forEach(([k, v]) => el.setAttribute(k, v)); svg.appendChild(el); });
		return svg;
	},

	createDock() {
		const container = document.createElement('div');
		container.id = 'halo-dock';
		const bar = document.createElement('div');
		bar.className = 'halo-dock-bar';

		const btns = [
			{ id: 'btn-top', icon: ICONS.ARROW_UP, tip: 'Top', action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
			{ id: 'btn-prev', icon: { text: '▲' }, tip: 'Prev (Alt+↑)', action: () => timelineManager?.nav(-1) },
			{ id: 'btn-next', icon: { text: '▼' }, tip: 'Next (Alt+↓)', action: () => timelineManager?.nav(1) },
			{ id: 'btn-wide', icon: ICONS.WIDE, tip: 'Widescreen (Alt+W)', action: () => Actions.toggleWide() }
		];

		btns.forEach(b => {
			const btn = document.createElement('button');
			btn.className = 'halo-btn';
			if (b.id) btn.id = b.id;
			if (b.icon.text) btn.textContent = b.icon.text;
			else btn.appendChild(this.createSvg(b.icon));
			btn.type = 'button';
			btn.title = b.tip;
			btn.onclick = b.action;
			bar.appendChild(btn);
		});

		container.appendChild(bar);
		document.body.appendChild(container);
		this.dock = container;
	},

	toggleWideBtn(active) {
		const b = document.getElementById('btn-wide');
		if (b) active ? b.classList.add('active') : b.classList.remove('active');
	},

	bindShortcuts() {
		window.addEventListener('keydown', (e) => {
			if (!config.enabled) return; // shortcuts toggle removed from default config but we can support it if needed
			if (e.altKey) {
				if (e.key === 'ArrowUp') { e.preventDefault(); timelineManager?.nav(-1); }
				if (e.key === 'ArrowDown') { e.preventDefault(); timelineManager?.nav(1); }
				if (e.code === 'KeyW') { e.preventDefault(); Actions.toggleWide(); }
			}
		});
	}
};

// ====== Actions ======
const Actions = {
	setConfig(key, val) { config[key] = val; saveConfig(); },
	toggleWide() { config.widescreen = !config.widescreen; saveConfig(); },
	// toggleSettings removed
	apply() {
		// Simple logic: if this script is running, the tool is enabled for this site.
		const isWide = config.widescreen;

		// Widescreen
		if (isWide) {
			document.body.setAttribute('data-halo-wide', 'true');
			document.documentElement.style.setProperty('--halo-llm-width', `${config.widthPercent}%`);
		} else {
			document.body.removeAttribute('data-halo-wide');
		}
		if (UI) UI.toggleWideBtn(isWide);

		// Visibility
		if (UI.dock) UI.dock.style.display = config.enabled ? 'block' : 'none';

		// Timeline visibility
		if (timelineManager) {
			timelineManager.setVisible(config.enabled && config.timeline);
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
	if (currentSite === 'chatgpt') {
		await import('./timeline/content-chatgpt');
	} else if (currentSite === 'deepseek') {
		await import('./timeline/content-deepseek');
	} else if (currentSite === 'gemini') {
		await import('./timeline/content-gemini');
	}

	// Keep Alive
	setInterval(() => {
		if (config.enabled && config.keepAlive) {
			const b = document.querySelector('.btn-continue, [aria-label*="Continue"]');
			if (b) b.click();
		}
	}, 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
