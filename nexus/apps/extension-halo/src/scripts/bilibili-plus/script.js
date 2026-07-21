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

	// ====== Config ======
	const CONFIG = {
		speedStep: 0.25,
		defaultQuality: true,
		cleanHome: true
	};

	// ====== Styles: Clean Mode ======
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
		/* Can be toggled via class if needed, for now applied always */
		.feed-card:has(.bili-video-card__info--ad) { display: none !important; }
	`;

	function injectStyles(css) {
		const style = document.createElement('style');
		style.textContent = css;
		style.setAttribute('data-halo', 'bilibili-plus');
		(document.head || document.documentElement).appendChild(style);
	}

	// ====== Feature: Playback Speed Shortcuts ======
	function initSpeedControl() {
		document.addEventListener('keydown', (e) => {
			// Ignore if typing in input
			if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) {
				return;
			}

			const video = document.querySelector('video');
			if (!video) return;

			// [ Slower, ] Faster, \ Reset
			if (e.key === '[' || e.key === '{') {
				video.playbackRate = Math.max(0.25, video.playbackRate - CONFIG.speedStep);
				showToast(`Speed: ${video.playbackRate}x`);
			} else if (e.key === ']' || e.key === '}') {
				video.playbackRate = Math.min(5.0, video.playbackRate + CONFIG.speedStep);
				showToast(`Speed: ${video.playbackRate}x`);
			} else if (e.key === '\\') {
				video.playbackRate = 1.0;
				showToast(`Speed: Reset (1.0x)`);
			}
		});
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

	// ====== Feature: Esc to Close Image Viewer ======
	function initEscFix() {
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				// Try various close buttons for image viewers
				const closeBtns = [
					'.bili-album__close', // Dynamic album
					'.preview-image-container .close-btn', // Comment images
					'.image-viewer-close' // Generic
				];

				for (const sel of closeBtns) {
					const btn = document.querySelector(sel);
					if (btn) {
						btn.click();
						console.log(LOG_TAG, 'Closed image viewer via Esc');
						return;
					}
				}
			}
		});
	}

	// ====== Feature: Highest Quality ======
	function enableHighestQuality() {
		const qualityObserver = new MutationObserver(() => {
			const qualityBtn = document.querySelector('.bpx-player-ctrl-quality-menu-item:not(.bpx-state-disabled)');
			if (qualityBtn && !sessionStorage.getItem('halo_bili_quality_set')) {
				const items = document.querySelectorAll('.bpx-player-ctrl-quality-menu-item:not(.bpx-state-disabled)');
				if (items.length > 0) {
					// Usually the first one is the highest available (e.g. 4K/1080P+)
					items[0].click();
					sessionStorage.setItem('halo_bili_quality_set', '1');
					console.log(LOG_TAG, 'Auto-selected highest quality');
					showToast('Halo: Highest Quality Selected');
					// rule: stop observing once quality is set — without disconnect the
					// observer keeps firing on every DOM mutation for the page's lifetime.
					qualityObserver.disconnect();
				}
			}
		});

		qualityObserver.observe(document.body, { childList: true, subtree: true });
		// rule: safety net — force disconnect after 30s on pages where the quality
		// menu never appears (e.g. embedded players, error pages).
		setTimeout(() => qualityObserver.disconnect(), 30000);
	}

	// ====== Feature: Auto Expand Description ======
	function autoExpandDesc() {
		const expandBtn = document.querySelector('.basic-desc-info.desc-info-btn');
		if (expandBtn) {
			expandBtn.click();
		}
	}

	// ====== Initialization ======
	function init() {
		console.log(LOG_TAG, 'Initializing...');

		injectStyles(cleanStyles);
		initSpeedControl();
		initEscFix();

		// rule: clear pending toast timer on page unload — without this the
		// setTimeout callback fires after the page is gone, logging a warning.
		const clearToastTimer = () => {
			const toast = document.getElementById('halo-toast');
			if (toast?.timer) clearTimeout(toast.timer);
		};
		window.addEventListener('pagehide', clearToastTimer);
		window.addEventListener('unload', clearToastTimer);

		// DOM Ready
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				enableHighestQuality();
				setTimeout(autoExpandDesc, 2000);
			});
		} else {
			enableHighestQuality();
			setTimeout(autoExpandDesc, 2000);
		}
	}

	init();
})();
