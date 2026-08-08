// HALO SaaT: bilibili-plus - B站增强脚本
// Features: Clean Mode, Playback Speed, Esc Fix, Highest Quality

(() => {
	// rule: init guard — content scripts can be injected multiple times (e.g. after
	// extension update/reload or programmatic re-injection), and each injection
	// re-registered keydown listeners and re-observed mutations, multiplying input
	// handling per key press and leaking observers.
	if (window.__haloBiliPlusInit) return;
	window.__haloBiliPlusInit = true;

	const LOG_TAG = '[HALO:Bilibili+]';

	const CONFIG = {
		speedStep: 0.25,
		defaultQuality: true,
		cleanHome: true
	};

	const cleanStyles = `
		/* === Ad Block === */
		.ad-report, .bili-video-card__info--ad, .video-card-ad-small,
		.pop-live-small-mode, .activity-banner, .eva-banner,
		.right-container .ad-floor, #slide_ad,
		.bilibili-player-dm-tip-wrap, .bpx-player-toast-wrap,
		.comment-list .ad-floor,
		.activity-game-list, .bili-search-flex-wrap {
			display: none !important;
		}

		/* === Clean Home Mode (Optional: Simplify Layout) === */
		.feed-card:has(.bili-video-card__info--ad) { display: none !important; }
	`;

	function injectStyles(css) {
		const style = document.createElement('style');
		style.textContent = css;
		style.setAttribute('data-halo', 'bilibili-plus');
		(document.head || document.documentElement).appendChild(style);
	}

	function showToast(msg) {
		let toast = document.getElementById('halo-toast');
		if (!toast) {
			toast = document.createElement('div');
			toast.id = 'halo-toast';
			toast.style.cssText = `
				position: fixed; top: 20%; left: 50%; transform: translate(-50%, -50%);
				background: rgba(0,0,0,0.7); color: white; padding: 10px 20px;
				border-radius: 5px; font-size: 16px; z-index: 10000; pointer-events: none;
				transition: opacity 0.5s;
			`;
			document.body.appendChild(toast);
		}
		toast.textContent = msg;
		toast.style.opacity = '1';
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => { toast.style.opacity = '0'; }, 1500);
	}

	// One document keydown owner. Most page key presses exit before any DOM query;
	// video lookup is paid only for the three speed-control key families.
	function initKeyboardControls() {
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				const closeSelectors = [
					'.bili-album__close',
					'.preview-image-container .close-btn',
					'.image-viewer-close'
				];
				for (const selector of closeSelectors) {
					const button = document.querySelector(selector);
					if (!button) continue;
					button.click();
					console.log(LOG_TAG, 'Closed image viewer via Esc');
					return;
				}
				return;
			}

			const speedKey = event.key === '[' || event.key === '{'
				|| event.key === ']' || event.key === '}'
				|| event.key === '\\';
			if (!speedKey) return;

			const active = document.activeElement;
			if (
				active instanceof HTMLInputElement
				|| active instanceof HTMLTextAreaElement
				|| active?.isContentEditable
			) return;

			const video = document.querySelector('video');
			if (!video) return;

			if (event.key === '[' || event.key === '{') {
				video.playbackRate = Math.max(0.25, video.playbackRate - CONFIG.speedStep);
				showToast(`Speed: ${video.playbackRate}x`);
			} else if (event.key === ']' || event.key === '}') {
				video.playbackRate = Math.min(5.0, video.playbackRate + CONFIG.speedStep);
				showToast(`Speed: ${video.playbackRate}x`);
			} else {
				video.playbackRate = 1.0;
				showToast('Speed: Reset (1.0x)');
			}
		});
	}

	function enableHighestQuality() {
		const storageKey = 'halo_bili_quality_set';
		if (sessionStorage.getItem(storageKey)) return;

		let observer = null;
		let frameId = 0;
		let timeoutId = 0;

		const cleanup = () => {
			observer?.disconnect();
			observer = null;
			if (frameId) cancelAnimationFrame(frameId);
			frameId = 0;
			if (timeoutId) clearTimeout(timeoutId);
			timeoutId = 0;
		};

		const trySelect = () => {
			if (sessionStorage.getItem(storageKey)) {
				cleanup();
				return true;
			}
			const items = document.querySelectorAll('.bpx-player-ctrl-quality-menu-item:not(.bpx-state-disabled)');
			const highest = items[0];
			if (!highest) return false;
			highest.click();
			sessionStorage.setItem(storageKey, '1');
			console.log(LOG_TAG, 'Auto-selected highest quality');
			showToast('Halo: Highest Quality Selected');
			cleanup();
			return true;
		};

		if (trySelect()) return;

		observer = new MutationObserver(() => {
			if (frameId) return;
			frameId = requestAnimationFrame(() => {
				frameId = 0;
				trySelect();
			});
		});
		observer.observe(document.body, { childList: true, subtree: true });
		timeoutId = setTimeout(cleanup, 30000);
	}

	function autoExpandDesc() {
		const expandBtn = document.querySelector('.basic-desc-info.desc-info-btn');
		if (expandBtn) expandBtn.click();
	}

	function init() {
		console.log(LOG_TAG, 'Initializing...');
		injectStyles(cleanStyles);
		initKeyboardControls();

		const clearToastTimer = () => {
			const toast = document.getElementById('halo-toast');
			if (toast?.timer) clearTimeout(toast.timer);
		};
		window.addEventListener('pagehide', clearToastTimer);
		window.addEventListener('unload', clearToastTimer);

		const initDomFeatures = () => {
			if (CONFIG.defaultQuality) enableHighestQuality();
			setTimeout(autoExpandDesc, 2000);
		};
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', initDomFeatures, { once: true });
		} else {
			initDomFeatures();
		}
	}

	init();
})();
