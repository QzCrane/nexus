
// HALO SaaT: Bilibili Enhancer
// Features: Clean Home Mode, Hide Hot Search, Stepless Video Rate
// Source: 0xlau/biliplus

(() => {
	

	const LOG_TAG = '[HALO:Bilibili]';
	const STORAGE_KEY = 'halo_bilibili_config';

	// Default Config
	const DEFAULT_CONFIG = {
		enabled: true,
		cleanHome: true,
		hideHotSearch: true,
		steplessRate: true
	};

	let config = { ...DEFAULT_CONFIG };

	function loadConfig() {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
		} catch (e) { console.error(LOG_TAG, e); }
	}

	function saveConfig() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
		applyConfig();
	}

	function applyConfig() {
		if (!config.enabled) return;

		// Clean Home
		if (config.cleanHome) applyCleanHome();

		// Hide Hot Search
		if (config.hideHotSearch) applyHideHotSearch();

		// Stepless Rate (Video Only)
		if (config.steplessRate && location.pathname.includes('/video/')) {
			applySteplessRate();
		}
	}

	// === Feature: Clean Home ===
	function applyCleanHome() {
		if (location.host !== 'www.bilibili.com' || location.pathname !== '/') return;

		document.body.setAttribute('halo-clean-mode', '');

		const swipe = document.querySelector('.recommended-swipe');
		if (swipe) swipe.style.display = 'none';

		// Trigger scroll to load more if needed
		// const scroll = new Event('scroll');
		// dispatchEvent(scroll);
	}

	// === Feature: Hide Hot Search ===
	// rule: module-level flag prevents stacking focusin listeners on repeated
	// applyConfig() calls (e.g. from saveConfig). Without the guard, each toggle
	// would add another listener that ran the same handler on every focusin.
	let focusinBound = false;
	function applyHideHotSearch() {
		document.body.classList.add('halo-hide-hot-search');

		const navSearchform = document.querySelector('#nav-searchform');
		if (navSearchform && !focusinBound) {
			focusinBound = true;
			navSearchform.addEventListener('focusin', () => {
				const history = document.querySelector('.search-panel .history');
				const searchPanel = document.querySelector('.search-panel');
				if (!history && searchPanel) {
					searchPanel.style.display = 'none';
				}
			});
		}
	}

	// === Feature: Stepless Video Rate ===
	function applySteplessRate() {
		// Wait for player
		// rule: cap retries so the interval is cleared if the player never appears
		// (e.g. SPA navigation away from a video). Without the cap, the interval
		// ran forever on non-video pages that hit this branch.
		let attempts = 0;
		const checkPlayer = setInterval(() => {
			attempts++;
			if (attempts > 30) {
				clearInterval(checkPlayer);
				return;
			}
			const video = document.querySelector('video');
			const controlRight = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-quality');

			if (video && controlRight) {
				clearInterval(checkPlayer);
				injectSteplessControls();
			}
		}, 1000);
	}

	function injectSteplessControls() {
		if (document.querySelector('.halo-speed-btn')) return;

		const container = document.querySelector('.bpx-player-ctrl-right');
		if (!container) return;

		// Create Button
		const btn = document.createElement('div');
		btn.className = 'halo-speed-btn bpx-player-ctrl-btn';
		btn.textContent = 'Speed';
		btn.style.marginRight = '10px';
		btn.style.cursor = 'pointer';

		// Speed Menu
		const menu = document.createElement('div');
		menu.className = 'halo-speed-menu';
		menu.style.display = 'none';

		const rates = [3.0, 2.5, 2.0, 1.75, 1.5, 1.25, 1.0, 0.75, 0.5];
		rates.forEach(rate => {
			const item = document.createElement('div');
			item.className = 'halo-speed-item';
			item.textContent = `${rate}x`;
			item.onclick = () => {
				const v = document.querySelector('video');
				if (v) v.playbackRate = rate;
				btn.textContent = `${rate}x`;
				menu.style.display = 'none';
			};
			menu.appendChild(item);
		});

		btn.appendChild(menu);

		// Toggle Menu
		btn.onmouseenter = () => menu.style.display = 'block';
		btn.onmouseleave = () => menu.style.display = 'none';

		container.insertBefore(btn, container.firstChild);
	}

	// Init
	loadConfig();
	injectStyles();
	applyConfig();

	function injectStyles() {
		const css = `
/* Bilibili Enhancer Styles */
/* Clean Home Mode */
body[halo-clean-mode] .recommended-swipe { display: none !important; }

/* Hide Hot Search */
.halo-hide-hot-search .nav-search-content .nav-search-input { border-radius: 8px !important; }
.halo-hide-hot-search .search-panel .hot-search { display: none !important; }

/* Stepless Rate */
.halo-speed-menu {
	position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
	background: rgba(0, 0, 0, 0.9); border-radius: 4px; padding: 5px 0; margin-bottom: 10px;
	width: 60px; text-align: center; z-index: 1000;
}
.halo-speed-item { padding: 4px 0; color: #fff; font-size: 12px; cursor: pointer; }
.halo-speed-item:hover { background: rgba(255, 255, 255, 0.2); }
.halo-speed-btn {
	position: relative; display: flex; align-items: center; justify-content: center;
	font-size: 14px; color: #fff; height: 100%; padding: 0 10px;
}
`;
		const style = document.createElement('style');
		style.textContent = css;
		style.id = 'halo-bilibili-css';
		document.head.appendChild(style);
	}

	// Settings UI (Simplified for now, can be integrated into Halo Dock later)
	// We'll expose a global toggle for testing
	window.HaloBili = {
		toggle: (key) => {
			config[key] = !config[key];
			saveConfig();
			console.log(LOG_TAG, key, config[key]);
		}
	};

})();
