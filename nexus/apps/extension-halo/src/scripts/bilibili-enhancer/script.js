// HALO SaaT: Bilibili Enhancer
// Features: Clean Home Mode, Hide Hot Search, Stepless Video Rate
// Source: 0xlau/biliplus

(() => {
	const LOG_TAG = '[HALO:Bilibili]';
	const STORAGE_KEY = 'halo_bilibili_config';

	const DEFAULT_CONFIG = {
		enabled: true,
		cleanHome: true,
		hideHotSearch: true,
		steplessRate: true
	};

	let config = { ...DEFAULT_CONFIG };
	let focusinBound = false;
	let stopSpeedDiscovery = null;

	function loadConfig() {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
		} catch (error) {
			console.error(LOG_TAG, error);
		}
	}

	function saveConfig() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
		applyConfig();
	}

	function applyConfig() {
		if (!config.enabled) {
			stopSpeedDiscovery?.();
			stopSpeedDiscovery = null;
			return;
		}
		if (config.cleanHome) applyCleanHome();
		if (config.hideHotSearch) applyHideHotSearch();
		if (config.steplessRate && location.pathname.includes('/video/')) {
			applySteplessRate();
		} else {
			stopSpeedDiscovery?.();
			stopSpeedDiscovery = null;
		}
	}

	function applyCleanHome() {
		if (location.host !== 'www.bilibili.com' || location.pathname !== '/') return;
		document.body.setAttribute('halo-clean-mode', '');
		const swipe = document.querySelector('.recommended-swipe');
		if (swipe) swipe.style.display = 'none';
	}

	function applyHideHotSearch() {
		document.body.classList.add('halo-hide-hot-search');
		const navSearchform = document.querySelector('#nav-searchform');
		if (navSearchform && !focusinBound) {
			focusinBound = true;
			navSearchform.addEventListener('focusin', () => {
				const history = document.querySelector('.search-panel .history');
				const searchPanel = document.querySelector('.search-panel');
				if (!history && searchPanel) searchPanel.style.display = 'none';
			});
		}
	}

	function applySteplessRate() {
		if (document.querySelector('.halo-speed-btn') || stopSpeedDiscovery) return;

		let observer = null;
		let frameId = 0;
		let timeoutId = 0;
		let disposed = false;

		const cleanup = () => {
			if (disposed) return;
			disposed = true;
			observer?.disconnect();
			observer = null;
			if (frameId) cancelAnimationFrame(frameId);
			if (timeoutId) clearTimeout(timeoutId);
			frameId = 0;
			timeoutId = 0;
			if (stopSpeedDiscovery === cleanup) stopSpeedDiscovery = null;
		};

		const tryInject = () => {
			if (document.querySelector('.halo-speed-btn')) {
				cleanup();
				return true;
			}
			const video = document.querySelector('video');
			const controlRight = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-quality');
			if (!video || !controlRight) return false;
			injectSteplessControls();
			cleanup();
			return true;
		};

		stopSpeedDiscovery = cleanup;
		if (tryInject()) return;

		observer = new MutationObserver(() => {
			if (frameId || disposed) return;
			frameId = requestAnimationFrame(() => {
				frameId = 0;
				if (!disposed) tryInject();
			});
		});
		observer.observe(document.body, { childList: true, subtree: true });
		timeoutId = setTimeout(cleanup, 30000);
	}

	function injectSteplessControls() {
		if (document.querySelector('.halo-speed-btn')) return;
		const container = document.querySelector('.bpx-player-ctrl-right');
		if (!container) return;

		const button = document.createElement('div');
		button.className = 'halo-speed-btn bpx-player-ctrl-btn';
		button.textContent = 'Speed';
		button.style.marginRight = '10px';
		button.style.cursor = 'pointer';

		const menu = document.createElement('div');
		menu.className = 'halo-speed-menu';
		menu.style.display = 'none';

		const rates = [3.0, 2.5, 2.0, 1.75, 1.5, 1.25, 1.0, 0.75, 0.5];
		for (const rate of rates) {
			const item = document.createElement('div');
			item.className = 'halo-speed-item';
			item.textContent = `${rate}x`;
			item.onclick = () => {
				const video = document.querySelector('video');
				if (video) video.playbackRate = rate;
				button.textContent = `${rate}x`;
				menu.style.display = 'none';
			};
			menu.appendChild(item);
		}

		button.appendChild(menu);
		button.onmouseenter = () => { menu.style.display = 'block'; };
		button.onmouseleave = () => { menu.style.display = 'none'; };
		container.insertBefore(button, container.firstChild);
	}

	function injectStyles() {
		const css = `
/* Bilibili Enhancer Styles */
body[halo-clean-mode] .recommended-swipe { display: none !important; }
.halo-hide-hot-search .nav-search-content .nav-search-input { border-radius: 8px !important; }
.halo-hide-hot-search .search-panel .hot-search { display: none !important; }
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

	loadConfig();
	injectStyles();
	applyConfig();
	window.addEventListener('pagehide', () => {
		stopSpeedDiscovery?.();
		stopSpeedDiscovery = null;
	}, { once: true });

	window.HaloBili = {
		toggle: (key) => {
			config[key] = !config[key];
			saveConfig();
			console.log(LOG_TAG, key, config[key]);
		}
	};
})();
